using UnityEngine;

public class ThirdPersonCamera : MonoBehaviour
{
    public Transform target;
    public Vector3 offset = new Vector3(0f, 4.2f, -5.5f);
    public float followLerp = 8f;
    public float lookLerp = 10f;

    void LateUpdate()
    {
        if (target == null) return;

        Vector3 desiredPos = target.position + offset;
        transform.position = Vector3.Lerp(transform.position, desiredPos, followLerp * Time.deltaTime);

        Vector3 lookPoint = target.position + Vector3.up * 1.2f;
        Vector3 lookDir = lookPoint - transform.position;
        if (lookDir.sqrMagnitude > 0.0001f)
        {
            Quaternion desiredRot = Quaternion.LookRotation(lookDir.normalized, Vector3.up);
            transform.rotation = Quaternion.Slerp(transform.rotation, desiredRot, lookLerp * Time.deltaTime);
        }
    }
}
