using UnityEngine;

public class UiFadeIn : MonoBehaviour
{
    public CanvasGroup canvasGroup;
    public float delay = 0f;
    public float duration = 0.6f;
    public float startYOffset = 24f;

    RectTransform rect;
    Vector2 targetPos;
    float timer;

    void Awake()
    {
        if (canvasGroup == null) canvasGroup = GetComponent<CanvasGroup>();
        rect = GetComponent<RectTransform>();
        if (rect != null) targetPos = rect.anchoredPosition;
        canvasGroup.alpha = 0f;
        timer = -delay;
    }

    void Update()
    {
        timer += Time.deltaTime;
        if (timer < 0f) return;

        float t = duration > 0f ? Mathf.Clamp01(timer / duration) : 1f;
        float eased = 1f - Mathf.Pow(1f - t, 3f);
        canvasGroup.alpha = eased;
        if (rect != null)
            rect.anchoredPosition = targetPos + Vector2.down * (startYOffset * (1f - eased));
    }
}
