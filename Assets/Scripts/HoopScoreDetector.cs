using System;
using UnityEngine;

public class HoopScoreDetector : MonoBehaviour
{
    public event Action OnScore;

    const float ScoreWindowSeconds = 1.2f;

    bool passedTopGoingDown;
    float topPassTime;

    public void NotifyTop(Collider ballCollider)
    {
        Rigidbody rb = ballCollider.attachedRigidbody;
        if (rb != null && rb.linearVelocity.y < 0f)
        {
            passedTopGoingDown = true;
            topPassTime = Time.time;
        }
    }

    public void NotifyBottom(Collider ballCollider)
    {
        if (!passedTopGoingDown || Time.time - topPassTime > ScoreWindowSeconds)
            return;

        Rigidbody rb = ballCollider.attachedRigidbody;
        if (rb == null || rb.linearVelocity.y < 0f)
        {
            passedTopGoingDown = false;
            OnScore?.Invoke();
        }
    }
}
