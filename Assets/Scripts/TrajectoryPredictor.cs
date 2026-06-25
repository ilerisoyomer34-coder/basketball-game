using System.Collections.Generic;
using UnityEngine;

[RequireComponent(typeof(LineRenderer))]
public class TrajectoryPredictor : MonoBehaviour
{
    public int steps = 30;
    public float timeStep = 0.05f;
    public float groundY = 0f;

    LineRenderer line;
    readonly List<Vector3> points = new List<Vector3>();

    void Awake()
    {
        line = GetComponent<LineRenderer>();
        line.positionCount = 0;
    }

    public void Show(Vector3 startPos, Vector3 startVelocity)
    {
        Vector3 gravity = Physics.gravity;
        points.Clear();
        points.Add(startPos);
        for (int i = 1; i < steps; i++)
        {
            float t = i * timeStep;
            Vector3 p = startPos + startVelocity * t + 0.5f * gravity * t * t;
            points.Add(p);
            if (p.y < groundY) break;
        }
        line.positionCount = points.Count;
        line.SetPositions(points.ToArray());
        line.enabled = true;
    }

    public void Hide()
    {
        line.enabled = false;
    }
}
