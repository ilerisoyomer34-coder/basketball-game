using UnityEditor;

public static class WebGLBuilder
{
    public static void Build()
    {
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;

        BuildPlayerOptions options = new BuildPlayerOptions
        {
            scenes = new[] { "Assets/Scenes/MainMenu.unity", "Assets/Scenes/Game.unity" },
            locationPathName = "WebBuild",
            target = BuildTarget.WebGL,
            options = BuildOptions.None
        };

        UnityEditor.Build.Reporting.BuildReport report = BuildPipeline.BuildPlayer(options);
        UnityEngine.Debug.Log("[WebGLBuilder] Build sonucu: " + report.summary.result + " - Hata sayısı: " + report.summary.totalErrors);
    }
}
