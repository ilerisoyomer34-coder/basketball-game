using UnityEngine;

[RequireComponent(typeof(PlayerCharacter))]
public class TeamAIController : MonoBehaviour
{
    [Header("Referanslar")]
    public BallLauncher ball;
    public PlayerCharacter[] teammates;
    public PlayerCharacter[] opponents;
    public Vector3 homeSlotPosition;

    [Header("Karar Ayarları")]
    public float decisionInterval = 1.2f;
    public float shootRange = 7f;
    public float passDecisionChance = 0.4f;
    public float shootAccuracy = 0.75f;

    PlayerCharacter self;
    float decisionTimer;

    void Awake()
    {
        self = GetComponent<PlayerCharacter>();
    }

    void Update()
    {
        if (ball == null || self == null) return;

        bool iHaveBall = ball.IsHeld && ball.Carrier == self;
        if (iHaveBall)
        {
            HandleBallCarrierDecision();
            MoveTowardHoopIfNeeded();
            return;
        }

        bool teamHasBall = ball.IsHeld && ball.Carrier != null && ball.Carrier.team == self.team;
        if (teamHasBall)
            MoveToSpacingPosition();
        else
            MoveToDefend();
    }

    void HandleBallCarrierDecision()
    {
        decisionTimer += Time.deltaTime;
        if (decisionTimer < decisionInterval) return;
        decisionTimer = 0f;

        Transform hoopTarget = self.offensiveHoop;
        float distToHoop = hoopTarget != null ? Vector3.Distance(transform.position, hoopTarget.position) : Mathf.Infinity;

        if (distToHoop <= shootRange)
        {
            ball.AutoShoot(shootAccuracy);
            return;
        }

        if (Random.value < passDecisionChance)
        {
            PlayerCharacter target = FindOpenTeammate();
            if (target != null)
                ball.Pass(target);
        }
    }

    void MoveTowardHoopIfNeeded()
    {
        Transform hoopTarget = self.offensiveHoop;
        if (hoopTarget == null) return;
        float dist = Vector3.Distance(transform.position, hoopTarget.position);
        if (dist > shootRange)
        {
            Vector3 dir = hoopTarget.position - transform.position;
            dir.y = 0f;
            self.Move(dir.normalized);
        }
    }

    void MoveToSpacingPosition()
    {
        Vector3 dir = homeSlotPosition - transform.position;
        dir.y = 0f;
        if (dir.magnitude > 0.3f)
            self.Move(dir.normalized);
    }

    void MoveToDefend()
    {
        PlayerCharacter markTarget = FindNearestOpponent();
        if (markTarget == null) return;

        Vector3 hoopPos = self.defensiveHoop != null ? self.defensiveHoop.position : transform.position;
        // Rakibi tamamen üstüne kapanmadan, kendi potasıyla rakip arasında konumlan (yardım savunması hissi).
        Vector3 betweenPoint = Vector3.Lerp(markTarget.transform.position, hoopPos, 0.3f);
        Vector3 dir = betweenPoint - transform.position;
        dir.y = 0f;
        if (dir.magnitude > 0.3f)
            self.Move(dir.normalized);
    }

    PlayerCharacter FindNearestOpponent()
    {
        if (opponents == null) return null;
        PlayerCharacter nearest = null;
        float bestDist = Mathf.Infinity;
        foreach (PlayerCharacter opp in opponents)
        {
            if (opp == null) continue;
            float d = Vector3.Distance(transform.position, opp.transform.position);
            if (d < bestDist)
            {
                bestDist = d;
                nearest = opp;
            }
        }
        return nearest;
    }

    PlayerCharacter FindOpenTeammate()
    {
        if (teammates == null) return null;
        PlayerCharacter best = null;
        float bestOpenness = -1f;
        foreach (PlayerCharacter mate in teammates)
        {
            if (mate == null || mate == self) continue;
            float nearestOpponentDist = Mathf.Infinity;
            if (opponents != null)
            {
                foreach (PlayerCharacter opp in opponents)
                {
                    if (opp == null) continue;
                    float d = Vector3.Distance(mate.transform.position, opp.transform.position);
                    if (d < nearestOpponentDist) nearestOpponentDist = d;
                }
            }
            if (nearestOpponentDist > bestOpenness)
            {
                bestOpenness = nearestOpponentDist;
                best = mate;
            }
        }
        return best;
    }
}
