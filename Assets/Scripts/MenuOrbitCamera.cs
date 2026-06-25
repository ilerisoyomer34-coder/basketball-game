using UnityEngine;

public class MenuOrbitCamera : MonoBehaviour
{
    public Vector3 pivot = Vector3.zero;
    public float radius = 16f;
    public float height = 8f;
    public float degreesPerSecond = 4f;

    float angle;

    void Update()
    {
        angle += degreesPerSecond * Time.deltaTime;
        float rad = angle * Mathf.Deg2Rad;
        transform.position = pivot + new Vector3(Mathf.Sin(rad) * radius, height, Mathf.Cos(rad) * radius);
        transform.LookAt(pivot + Vector3.up * 1.5f);
    }
}
