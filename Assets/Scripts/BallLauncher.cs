using System;
using UnityEngine;

[RequireComponent(typeof(Rigidbody), typeof(AudioSource))]
public class BallLauncher : MonoBehaviour
{
    [Header("Referanslar")]
    public TrajectoryPredictor trajectoryPredictor;
    public Vector3 hoopTarget = new Vector3(0f, 3.05f, 0.14f);
    public PlayerCharacter[] allPlayers;

    [Header("Güç / Yön Sürükleme (piksel)")]
    public float maxPowerDragPixels = 250f;
    public float maxLateralDragPixels = 200f;
    public float minDragPixelsToShoot = 15f;
    public float lateralSteerStrength = 0.6f;

    [Header("Atış Açısı / Hızı")]
    public float minLaunchAngle = 38f;
    public float maxLaunchAngle = 55f;
    public float minLaunchSpeed = 6f;
    public float maxLaunchSpeed = 11f;

    [Header("Sıfırlama")]
    public float settleSpeedThreshold = 0.05f;
    public float settleCheckDelay = 0.5f;
    public float maxFlightTime = 6f;
    public float outOfBoundsY = -3f;

    [Header("Sahiplenme / Pas")]
    public float pickupRadius = 0.7f;
    public float passSpeed = 9f;
    public float passArrivalRadius = 0.5f;

    [Header("Ses")]
    public float minBounceSpeedForSound = 0.5f;
    public float bounceSoundFullVolumeSpeed = 8f;
    public float bounceSoundCooldown = 0.08f;

    public event Action OnShotLaunched;
    public event Action OnBallSettled;
    public event Action<PlayerCharacter> OnPossessionChanged;

    Rigidbody rb;
    AudioSource audioSource;
    AudioClip swishClip;
    AudioClip bounceClip;
    Vector3 restPosition;
    Vector2 downScreenPos;
    bool isAiming;
    bool isFlying;
    bool isHeld;
    PlayerCharacter carrier;
    PlayerCharacter pendingPassTarget;
    float settleTimer;
    float flightTimer;
    float lastBounceSoundTime;

    public bool IsHeld => isHeld;
    public PlayerCharacter Carrier => carrier;

    void Awake()
    {
        rb = GetComponent<Rigidbody>();
        audioSource = GetComponent<AudioSource>();
        audioSource.playOnAwake = false;
        swishClip = ProceduralAudio.CreateSwish();
        bounceClip = ProceduralAudio.CreateBounce();
        restPosition = transform.position;
        // Sahiplenme sistemi olmayan eski tek-toplu pratik sahnesinde top serbestçe nişanlanabilir kalır.
        isHeld = true;
        carrier = null;
        SetKinematicReady();
    }

    void OnCollisionEnter(Collision collision)
    {
        float speed = collision.relativeVelocity.magnitude;
        if (speed < minBounceSpeedForSound || Time.time - lastBounceSoundTime < bounceSoundCooldown)
            return;

        lastBounceSoundTime = Time.time;
        float volume = Mathf.Clamp01(speed / bounceSoundFullVolumeSpeed);
        audioSource.PlayOneShot(bounceClip, volume);
    }

    public void SetRestPosition(Vector3 pos)
    {
        restPosition = pos;
        transform.position = pos;
    }

    public void AttachToCarrier(PlayerCharacter newCarrier)
    {
        carrier = newCarrier;
        isHeld = true;
        isFlying = false;
        isAiming = false;
        pendingPassTarget = null;
        rb.linearVelocity = Vector3.zero;
        rb.angularVelocity = Vector3.zero;
        rb.isKinematic = true;
        if (carrier != null)
        {
            restPosition = carrier.handAnchor.position;
            if (carrier.offensiveHoop != null)
                hoopTarget = carrier.offensiveHoop.position;
        }
        OnPossessionChanged?.Invoke(carrier);
    }

    public void AutoShoot(float accuracy01 = 1f)
    {
        if (!isHeld) return;

        float angleRad = Mathf.Lerp(minLaunchAngle, maxLaunchAngle, 0.5f) * Mathf.Deg2Rad;
        Vector3 dirFlat = HorizontalDirectionToHoop();

        // Düşük doğrulukta yatay sapma ekleyerek AI atışlarının her zaman girmemesini sağlıyoruz.
        float inaccuracy = (1f - Mathf.Clamp01(accuracy01)) * 0.3f;
        if (inaccuracy > 0f)
        {
            Vector3 rightAxis = Vector3.Cross(dirFlat, Vector3.up);
            dirFlat = (dirFlat + rightAxis * UnityEngine.Random.Range(-inaccuracy, inaccuracy)).normalized;
        }

        Vector3 launchDir = (dirFlat * Mathf.Cos(angleRad) + Vector3.up * Mathf.Sin(angleRad)).normalized;
        float speed = ComputeSpeedForRange(angleRad) * UnityEngine.Random.Range(1f - inaccuracy * 0.3f, 1f + inaccuracy * 0.3f);
        Launch(launchDir * speed);
    }

    public void Pass(PlayerCharacter target)
    {
        if (!isHeld || target == null) return;

        carrier = null;
        isHeld = false;
        pendingPassTarget = target;
        rb.isKinematic = false;

        Vector3 toTarget = target.handAnchor.position - transform.position;
        float distance = toTarget.magnitude;
        Vector3 velocity = toTarget.normalized * passSpeed;
        velocity.y += Mathf.Min(2.5f, distance * 0.15f);
        rb.linearVelocity = velocity;

        isFlying = true;
        flightTimer = 0f;
        settleTimer = 0f;
        OnPossessionChanged?.Invoke(null);
    }

    void Update()
    {
        if (isHeld)
        {
            FollowCarrier();
            if (carrier == null || carrier.isHumanControlled)
                HandlePointerInput();
            return;
        }

        if (isFlying)
        {
            HandleFlight();
        }
        else
        {
            CheckForPickup();
        }
    }

    void FollowCarrier()
    {
        if (carrier == null || isAiming) return;
        transform.position = carrier.handAnchor.position;
        transform.rotation = carrier.handAnchor.rotation;
        restPosition = carrier.handAnchor.position;
    }

    void CheckForPickup()
    {
        trajectoryPredictor?.Hide();
        if (allPlayers == null) return;

        foreach (PlayerCharacter p in allPlayers)
        {
            if (p == null) continue;
            if (Vector3.Distance(transform.position, p.handAnchor.position) <= pickupRadius)
            {
                AttachToCarrier(p);
                return;
            }
        }
    }

    bool TryGetPointer(out Vector2 screenPos, out bool down, out bool held, out bool up)
    {
        if (Input.touchCount > 0)
        {
            Touch t = Input.GetTouch(0);
            screenPos = t.position;
            down = t.phase == TouchPhase.Began;
            held = t.phase == TouchPhase.Moved || t.phase == TouchPhase.Stationary;
            up = t.phase == TouchPhase.Ended || t.phase == TouchPhase.Canceled;
            return true;
        }
        if (Input.mousePresent)
        {
            screenPos = Input.mousePosition;
            down = Input.GetMouseButtonDown(0);
            held = Input.GetMouseButton(0);
            up = Input.GetMouseButtonUp(0);
            return true;
        }
        screenPos = default;
        down = held = up = false;
        return false;
    }

    void HandlePointerInput()
    {
        if (!TryGetPointer(out var screenPos, out var down, out var held, out var up))
        {
            trajectoryPredictor?.Hide();
            return;
        }

        if (down && !isAiming)
        {
            isAiming = true;
            downScreenPos = screenPos;
        }

        if (isAiming && (held || down))
        {
            Vector2 dragPixels = screenPos - downScreenPos;
            ComputeAim(dragPixels, out Vector3 launchVelocity, out float power);

            // Görsel geri besleme: topu hafifçe potanın tersi yöne çekiyoruz (sapan hissi).
            Vector3 backDir = -HorizontalDirectionToHoop();
            transform.position = restPosition + backDir * (power * 0.6f);

            if (dragPixels.magnitude > minDragPixelsToShoot)
                trajectoryPredictor?.Show(transform.position, launchVelocity);
            else
                trajectoryPredictor?.Hide();
        }

        if (isAiming && up)
        {
            isAiming = false;
            trajectoryPredictor?.Hide();
            Vector2 dragPixels = screenPos - downScreenPos;

            if (dragPixels.magnitude >= minDragPixelsToShoot)
            {
                ComputeAim(dragPixels, out Vector3 launchVelocity, out _);
                Launch(launchVelocity);
            }
            else
            {
                transform.position = restPosition;
            }
        }
    }

    Vector3 HorizontalDirectionToHoop()
    {
        Vector3 toHoop = hoopTarget - restPosition;
        toHoop.y = 0f;
        if (toHoop.sqrMagnitude < 0.0001f) toHoop = Vector3.forward;
        return toHoop.normalized;
    }

    void ComputeAim(Vector2 dragPixels, out Vector3 launchVelocity, out float power)
    {
        // Aşağı çekme = atış kavisi (açı). Yatay çekme = sağ/sol nişan sapması.
        float downDrag = Mathf.Max(0f, -dragPixels.y);
        power = Mathf.Clamp01(downDrag / maxPowerDragPixels);
        float lateral = Mathf.Clamp(dragPixels.x / maxLateralDragPixels, -1f, 1f);

        Vector3 toHoopFlat = HorizontalDirectionToHoop();
        Vector3 rightAxis = Vector3.Cross(toHoopFlat, Vector3.up);
        Vector3 aimDirFlat = (toHoopFlat + rightAxis * (lateral * lateralSteerStrength)).normalized;

        float angleRad = Mathf.Lerp(minLaunchAngle, maxLaunchAngle, power) * Mathf.Deg2Rad;
        Vector3 launchDir = (aimDirFlat * Mathf.Cos(angleRad) + Vector3.up * Mathf.Sin(angleRad)).normalized;

        // Seçilen açıda potanın gerçek mesafesine ulaşacak hızı fizik formülüyle hesapla;
        // böylece güç sadece kavis şeklini belirler, mesafe her zaman doğru olur.
        float speed = ComputeSpeedForRange(angleRad);
        launchVelocity = launchDir * speed;
    }

    float ComputeSpeedForRange(float angleRad)
    {
        float horizontalDistance = new Vector2(hoopTarget.x - restPosition.x, hoopTarget.z - restPosition.z).magnitude;
        float heightDiff = hoopTarget.y - restPosition.y;
        float g = Mathf.Abs(Physics.gravity.y);

        float cosA = Mathf.Cos(angleRad);
        float tanA = Mathf.Tan(angleRad);
        float denom = 2f * cosA * cosA * (horizontalDistance * tanA - heightDiff);

        if (denom <= 0.01f)
            return maxLaunchSpeed;

        float speed = Mathf.Sqrt((g * horizontalDistance * horizontalDistance) / denom);
        return Mathf.Clamp(speed, minLaunchSpeed, maxLaunchSpeed * 1.5f);
    }

    void Launch(Vector3 velocity)
    {
        transform.position = restPosition;
        isHeld = false;
        carrier = null;
        rb.isKinematic = false;
        rb.linearVelocity = velocity;
        isFlying = true;
        flightTimer = 0f;
        settleTimer = 0f;
        audioSource.PlayOneShot(swishClip);
        OnShotLaunched?.Invoke();
        OnPossessionChanged?.Invoke(null);
    }

    void HandleFlight()
    {
        flightTimer += Time.deltaTime;

        if (pendingPassTarget != null)
        {
            float distToTarget = Vector3.Distance(transform.position, pendingPassTarget.handAnchor.position);
            if (distToTarget <= passArrivalRadius)
            {
                AttachToCarrier(pendingPassTarget);
                return;
            }
        }

        if (rb.linearVelocity.magnitude < settleSpeedThreshold)
        {
            settleTimer += Time.deltaTime;
            if (settleTimer >= settleCheckDelay)
            {
                Settle();
                return;
            }
        }
        else
        {
            settleTimer = 0f;
        }

        if (flightTimer >= maxFlightTime || transform.position.y < outOfBoundsY)
        {
            Settle();
        }
    }

    void Settle()
    {
        isFlying = false;
        pendingPassTarget = null;
        OnBallSettled?.Invoke();
    }

    void SetKinematicReady()
    {
        if (!rb.isKinematic)
        {
            // Kinematic gövdeler için velocity ayarlamak Unity'de uyarı üretir;
            // bu yüzden hâlâ dinamikken sıfırlayıp ardından kinematic'e geçiyoruz.
            rb.linearVelocity = Vector3.zero;
            rb.angularVelocity = Vector3.zero;
        }
        rb.isKinematic = true;
        isFlying = false;
        isAiming = false;
        transform.position = restPosition;
        transform.rotation = Quaternion.identity;
    }

    public void ResetForNextShot()
    {
        if (carrier != null)
        {
            AttachToCarrier(carrier);
        }
        else
        {
            isHeld = true;
            SetKinematicReady();
        }
    }
}
