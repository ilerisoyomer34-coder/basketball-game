using UnityEngine;

public enum Team { Home, Away }

[RequireComponent(typeof(CharacterController))]
public class PlayerCharacter : MonoBehaviour
{
    [Header("Kimlik")]
    public string playerName = "Player";
    public int jerseyNumber;
    public Team team;
    public bool isHumanControlled;

    [Header("Öznitelikler")]
    public float moveSpeed = 5f;
    public float turnSpeed = 720f;

    public Transform handAnchor;
    public Transform offensiveHoop;
    public Transform defensiveHoop;

    CharacterController controller;

    public Vector3 FacingDirection => transform.forward;

    void Awake()
    {
        controller = GetComponent<CharacterController>();
        if (handAnchor == null)
        {
            var anchorGO = new GameObject("HandAnchor");
            anchorGO.transform.SetParent(transform, false);
            anchorGO.transform.localPosition = new Vector3(0.3f, 1.1f, 0.4f);
            handAnchor = anchorGO.transform;
        }
    }

    public void Move(Vector3 worldDirection)
    {
        if (worldDirection.sqrMagnitude > 0.0001f)
        {
            worldDirection.Normalize();
            Quaternion targetRot = Quaternion.LookRotation(worldDirection, Vector3.up);
            transform.rotation = Quaternion.RotateTowards(transform.rotation, targetRot, turnSpeed * Time.deltaTime);
        }

        Vector3 motion = worldDirection * moveSpeed;
        // CharacterController yere değmeden de "grounded" sayılabiliyor; küçük bir aşağı itme ile zemine yapışık tutuyoruz.
        motion.y = -2f;
        controller.Move(motion * Time.deltaTime);
    }
}
