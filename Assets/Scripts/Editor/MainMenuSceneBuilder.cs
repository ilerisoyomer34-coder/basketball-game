using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

public static class MainMenuSceneBuilder
{
    const string CourtAssetPath = "Assets/Models/Court.fbx";
    const string StadiumAssetPath = "Assets/Models/Stadium.fbx";
    const string ScenePath = "Assets/Scenes/MainMenu.unity";
    const string GameScenePath = "Assets/Scenes/Game.unity";

    [MenuItem("Basketball/Build Main Menu Scene")]
    public static void BuildMainMenuScene()
    {
        Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        GameObject courtAsset = AssetDatabase.LoadAssetAtPath<GameObject>(CourtAssetPath);
        GameObject stadiumAsset = AssetDatabase.LoadAssetAtPath<GameObject>(StadiumAssetPath);

        if (courtAsset != null)
            ((GameObject)PrefabUtility.InstantiatePrefab(courtAsset)).name = "Court";
        if (stadiumAsset != null)
            ((GameObject)PrefabUtility.InstantiatePrefab(stadiumAsset)).name = "Stadium";

        GameObject lightGO = new GameObject("Directional Light");
        Light light = lightGO.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1.2f;
        light.shadows = LightShadows.Soft;
        lightGO.transform.rotation = Quaternion.Euler(45f, -25f, 0f);

        GameObject camGO = new GameObject("Main Camera");
        camGO.tag = "MainCamera";
        camGO.AddComponent<Camera>().fieldOfView = 55f;
        camGO.AddComponent<AudioListener>();
        MenuOrbitCamera orbit = camGO.AddComponent<MenuOrbitCamera>();
        orbit.pivot = new Vector3(0f, 1.5f, 12f);
        orbit.radius = 16f;
        orbit.height = 8f;

        GameObject esGO = new GameObject("EventSystem");
        esGO.AddComponent<UnityEngine.EventSystems.EventSystem>();
        esGO.AddComponent<UnityEngine.EventSystems.StandaloneInputModule>();

        GameObject canvasGO = new GameObject("Canvas");
        Canvas canvas = canvasGO.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        CanvasScaler scaler = canvasGO.AddComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);
        canvasGO.AddComponent<GraphicRaycaster>();

        Font font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

        GameObject overlayGO = new GameObject("DarkOverlay");
        overlayGO.transform.SetParent(canvasGO.transform, false);
        RectTransform overlayRect = overlayGO.AddComponent<RectTransform>();
        overlayRect.anchorMin = Vector2.zero;
        overlayRect.anchorMax = Vector2.one;
        overlayRect.offsetMin = Vector2.zero;
        overlayRect.offsetMax = Vector2.zero;
        Image overlayImg = overlayGO.AddComponent<Image>();
        overlayImg.color = new Color(0f, 0f, 0f, 0.45f);

        CreateFadeText(canvasGO.transform, "TitleText", font, "ULTIMATE BASKETBALL", 72,
            new Vector2(0.5f, 0.78f), new Vector2(0.5f, 0.78f), Vector2.zero, new Vector2(900f, 120f), TextAnchor.MiddleCenter, 0f);

        CreateFadeText(canvasGO.transform, "SubtitleText", font, "5'e 5 Sokak Basketbolu", 28,
            new Vector2(0.5f, 0.68f), new Vector2(0.5f, 0.68f), Vector2.zero, new Vector2(700f, 60f), TextAnchor.MiddleCenter, 0.25f);

        GameObject buttonPanelGO = new GameObject("ButtonPanel");
        buttonPanelGO.transform.SetParent(canvasGO.transform, false);
        RectTransform panelRect = buttonPanelGO.AddComponent<RectTransform>();
        panelRect.anchorMin = new Vector2(0.5f, 0.5f);
        panelRect.anchorMax = new Vector2(0.5f, 0.5f);
        panelRect.anchoredPosition = new Vector2(0f, -80f);
        panelRect.sizeDelta = new Vector2(320f, 180f);
        VerticalLayoutGroup vlg = buttonPanelGO.AddComponent<VerticalLayoutGroup>();
        vlg.childAlignment = TextAnchor.MiddleCenter;
        vlg.spacing = 18f;
        vlg.childControlHeight = false;
        vlg.childControlWidth = false;
        CanvasGroup panelCanvasGroup = buttonPanelGO.AddComponent<CanvasGroup>();
        UiFadeIn panelFade = buttonPanelGO.AddComponent<UiFadeIn>();
        panelFade.canvasGroup = panelCanvasGroup;
        panelFade.delay = 0.5f;

        GameObject startButtonGO = CreateMenuButton(buttonPanelGO.transform, "StartButton", font, "MAÇA BAŞLA", new Color(0.85f, 0.25f, 0.1f, 0.95f));
        GameObject quitButtonGO = CreateMenuButton(buttonPanelGO.transform, "QuitButton", font, "ÇIKIŞ", new Color(0.2f, 0.22f, 0.26f, 0.95f));

        GameObject controllerGO = new GameObject("MainMenuController");
        MainMenuController controller = controllerGO.AddComponent<MainMenuController>();
        controller.matchSceneName = "Game";
        startButtonGO.GetComponent<Button>().onClick.AddListener(controller.StartMatch);
        quitButtonGO.GetComponent<Button>().onClick.AddListener(controller.QuitGame);

        EnsureScenesDirectory();
        EditorSceneManager.SaveScene(scene, ScenePath);
        AssetDatabase.SaveAssets();

        RegisterScenesInBuildSettings();

        Debug.Log("[MainMenuSceneBuilder] Ana menü sahnesi oluşturuldu ve kaydedildi: " + ScenePath);
    }

    static GameObject CreateFadeText(Transform parent, string name, Font font, string content, int fontSize,
        Vector2 anchorMin, Vector2 anchorMax, Vector2 anchoredPos, Vector2 sizeDelta, TextAnchor alignment, float delay)
    {
        GameObject go = new GameObject(name);
        go.transform.SetParent(parent, false);
        RectTransform rect = go.AddComponent<RectTransform>();
        rect.anchorMin = anchorMin;
        rect.anchorMax = anchorMax;
        rect.anchoredPosition = anchoredPos;
        rect.sizeDelta = sizeDelta;
        Text text = go.AddComponent<Text>();
        text.font = font;
        text.fontSize = fontSize;
        text.text = content;
        text.color = Color.white;
        text.alignment = alignment;

        CanvasGroup cg = go.AddComponent<CanvasGroup>();
        UiFadeIn fade = go.AddComponent<UiFadeIn>();
        fade.canvasGroup = cg;
        fade.delay = delay;
        return go;
    }

    static GameObject CreateMenuButton(Transform parent, string name, Font font, string label, Color color)
    {
        GameObject go = new GameObject(name);
        go.transform.SetParent(parent, false);
        go.AddComponent<RectTransform>();
        LayoutElement le = go.AddComponent<LayoutElement>();
        le.preferredWidth = 280f;
        le.preferredHeight = 64f;
        Image img = go.AddComponent<Image>();
        img.color = color;
        go.AddComponent<Button>();

        GameObject textGO = new GameObject("Text");
        textGO.transform.SetParent(go.transform, false);
        RectTransform textRect = textGO.AddComponent<RectTransform>();
        textRect.anchorMin = Vector2.zero;
        textRect.anchorMax = Vector2.one;
        textRect.offsetMin = Vector2.zero;
        textRect.offsetMax = Vector2.zero;
        Text text = textGO.AddComponent<Text>();
        text.font = font;
        text.text = label;
        text.alignment = TextAnchor.MiddleCenter;
        text.color = Color.white;
        text.fontSize = 28;

        return go;
    }

    static void EnsureScenesDirectory()
    {
        if (!AssetDatabase.IsValidFolder("Assets/Scenes"))
            AssetDatabase.CreateFolder("Assets", "Scenes");
    }

    static void RegisterScenesInBuildSettings()
    {
        EditorBuildSettings.scenes = new[]
        {
            new EditorBuildSettingsScene(ScenePath, true),
            new EditorBuildSettingsScene(GameScenePath, true),
        };
    }
}
