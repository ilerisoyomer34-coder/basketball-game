using UnityEngine;

public static class ProceduralAudio
{
    const int SampleRate = 44100;

    public static AudioClip CreateSwish()
    {
        const float duration = 0.3f;
        int n = Mathf.RoundToInt(SampleRate * duration);
        float[] data = new float[n];
        float filtered = 0f;
        for (int i = 0; i < n; i++)
        {
            float t = i / (float)SampleRate;
            float envelope = Mathf.Sin(Mathf.PI * (t / duration));
            float noise = Random.Range(-1f, 1f);
            // Beyaz gürültüyü alçak geçiren basit bir filtreden geçirip "hışırtı" karakteri veriyoruz.
            filtered += (noise - filtered) * 0.2f;
            data[i] = filtered * envelope * 0.5f;
        }
        return BuildClip("ProceduralSwish", data);
    }

    public static AudioClip CreateBounce()
    {
        const float duration = 0.18f;
        const float toneFreq = 140f;
        int n = Mathf.RoundToInt(SampleRate * duration);
        float[] data = new float[n];
        for (int i = 0; i < n; i++)
        {
            float t = i / (float)SampleRate;
            float envelope = Mathf.Exp(-t * 26f);
            float tone = Mathf.Sin(2f * Mathf.PI * toneFreq * t);
            float click = t < 0.004f ? Random.Range(-1f, 1f) * 0.6f : 0f;
            data[i] = Mathf.Clamp((tone * 0.8f + click) * envelope, -1f, 1f);
        }
        return BuildClip("ProceduralBounce", data);
    }

    public static AudioClip CreateScoreChime()
    {
        const float duration = 0.5f;
        const float note1 = 880f;
        const float note2 = 1318.5f;
        const float note2Delay = 0.08f;
        int n = Mathf.RoundToInt(SampleRate * duration);
        float[] data = new float[n];
        for (int i = 0; i < n; i++)
        {
            float t = i / (float)SampleRate;
            float a = Mathf.Sin(2f * Mathf.PI * note1 * t) * Mathf.Exp(-t * 6f);
            float b = t > note2Delay
                ? Mathf.Sin(2f * Mathf.PI * note2 * t) * Mathf.Exp(-(t - note2Delay) * 6f)
                : 0f;
            data[i] = Mathf.Clamp(a * 0.5f + b * 0.5f, -1f, 1f);
        }
        return BuildClip("ProceduralScoreChime", data);
    }

    public static AudioClip CreateBuzzer()
    {
        const float duration = 1.0f;
        const float freq = 220f;
        const float fadeOut = 0.05f;
        int n = Mathf.RoundToInt(SampleRate * duration);
        float[] data = new float[n];
        for (int i = 0; i < n; i++)
        {
            float t = i / (float)SampleRate;
            float envelope = t < duration - fadeOut ? 1f : Mathf.Lerp(1f, 0f, (t - (duration - fadeOut)) / fadeOut);
            float square = Mathf.Sign(Mathf.Sin(2f * Mathf.PI * freq * t));
            data[i] = square * 0.35f * envelope;
        }
        return BuildClip("ProceduralBuzzer", data);
    }

    static AudioClip BuildClip(string name, float[] samples)
    {
        AudioClip clip = AudioClip.Create(name, samples.Length, 1, SampleRate, false);
        clip.SetData(samples, 0);
        return clip;
    }
}
