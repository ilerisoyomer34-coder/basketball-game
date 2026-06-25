using UnityEngine;

[RequireComponent(typeof(PlayerCharacter))]
public class HumanPlayerInput : MonoBehaviour
{
    public Camera followCamera;

    PlayerCharacter player;

    void Awake()
    {
        player = GetComponent<PlayerCharacter>();
        if (followCamera == null) followCamera = Camera.main;
    }

    void Update()
    {
        float h = Input.GetAxisRaw("Horizontal");
        float v = Input.GetAxisRaw("Vertical");
        Vector3 input = new Vector3(h, 0f, v);
        if (input.sqrMagnitude > 1f) input.Normalize();

        Vector3 camForward = Vector3.forward;
        Vector3 camRight = Vector3.right;
        if (followCamera != null)
        {
            camForward = Vector3.ProjectOnPlane(followCamera.transform.forward, Vector3.up).normalized;
            camRight = Vector3.ProjectOnPlane(followCamera.transform.right, Vector3.up).normalized;
        }

        Vector3 worldDir = camForward * input.z + camRight * input.x;
        player.Move(worldDir);
    }
}
