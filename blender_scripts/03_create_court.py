"""
TAM SAHA (FULL COURT) MODELI - Blender Python Script
Headless çalıştırma: blender --background --python 03_create_court.py

Üretir:
  - Assets/Models/Court.fbx (tam saha zemini, iki uçlu çizgilerle)
  - Assets/Textures/court_albedo.png (ahşap zemin + saha çizgileri, üstten bakı dokusu)

Not: Hoop A merkezi 01_create_hoop.py içindeki rim_y (~ -0.144) ile hizalı.
     Hoop B, Hoop A'nın Z ekseninde (Blender Y) ayna simetriği, tam saha
     uzunluğu kadar öteye yerleştirilir. Unity tarafında iki pota da bu
     pozisyonlara göre instantiate edilir (BasketballSceneBuilder.cs).
"""

import bpy
import math
import os
import numpy as np

PROJECT_ROOT = "/Users/ILERISOY/basketball-game"
MODELS_DIR = os.path.join(PROJECT_ROOT, "Assets", "Models")
TEXTURES_DIR = os.path.join(PROJECT_ROOT, "Assets", "Textures")
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(TEXTURES_DIR, exist_ok=True)

# Hoop scriptiyle birebir aynı değer (rim_y = 0.085 - RIM_RADIUS)
BASKET_A_Y = 0.085 - 0.2286
COURT_LENGTH = 28.65   # NBA tam saha uzunluğu (~94ft)
SIDELINE_X = 7.5        # NBA tam saha genişliği ~15.24m -> yarısı ~7.62, yuvarlandı

BASELINE_A_Y = BASKET_A_Y + 1.2
FREE_THROW_A_Y = BASKET_A_Y - 4.3

BASELINE_B_Y = BASELINE_A_Y - COURT_LENGTH
BASKET_B_Y = BASELINE_B_Y + 1.2
FREE_THROW_B_Y = BASKET_B_Y + 4.3

MIDLINE_Y = (BASELINE_A_Y + BASELINE_B_Y) / 2.0

THREE_POINT_RADIUS = 7.24
KEY_HALF_WIDTH = 2.45
CIRCLE_RADIUS = 1.8
RESTRICTED_RADIUS = 1.25

# Bu pay, 04_create_stadium.py'deki AD_BOARD_GAP(0.6) + BLEACHER_START ekstra(0.8) toplamını
# (~1.4m, saha kenarından ilk tribün sırasına mesafe) aşacak şekilde seçildi; tahta zemin
# tribün diplerine kadar boşluksuz devam etsin ("tahta zeminin devamı").
FLOOR_MARGIN = 2.0
FLOOR_X_MIN, FLOOR_X_MAX = -SIDELINE_X - FLOOR_MARGIN, SIDELINE_X + FLOOR_MARGIN
FLOOR_Y_MAX = BASELINE_A_Y + FLOOR_MARGIN
FLOOR_Y_MIN = BASELINE_B_Y - FLOOR_MARGIN


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)


def setup_units():
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0


def create_court_texture(path, size_x=2048):
    # Zemin dikdörtgen (X != Y uzunluğu); doku da ayni en-boy oranında olmazsa
    # daireler (üçlük çizgisi, orta yuvarlak) düzlemde eliptik görünür.
    aspect = (FLOOR_Y_MAX - FLOOR_Y_MIN) / (FLOOR_X_MAX - FLOOR_X_MIN)
    size_y = int(round(size_x * aspect))

    # Blender'da piksel arabelleği alttan üste dolar (V=0 alt sıra), bu yüzden
    # satır 0 -> FLOOR_Y_MIN olacak şekilde sıralıyoruz ki düzlem UV'siyle hizalansın.
    xs = np.linspace(FLOOR_X_MIN, FLOOR_X_MAX, size_x)
    ys = np.linspace(FLOOR_Y_MIN, FLOOR_Y_MAX, size_y)
    xx, yy = np.meshgrid(xs, ys)

    # Ahşap zemin: hafif çizgili tahta deseni + gürültü
    plank_id = np.floor((xx - FLOOR_X_MIN) / 0.6)
    grain = np.sin(yy * 18.0 + plank_id * 1.7) * 0.015
    plank_edge = (np.abs(((xx - FLOOR_X_MIN) % 0.6) - 0.3) > 0.295).astype(np.float32) * 0.03
    base = np.array([0.72, 0.52, 0.30])
    rgb = np.zeros((size_y, size_x, 3), dtype=np.float32)
    for c in range(3):
        rgb[..., c] = base[c] + grain - plank_edge

    line_w = 0.035
    lines = np.zeros((size_y, size_x), dtype=np.float32)

    def add_line(mask):
        nonlocal lines
        lines = np.maximum(lines, mask.astype(np.float32))

    def add_end_markings(basket_y, baseline_y, free_throw_y, sign):
        """sign = -1: sahaya giriş -Y yönünde (A ucu), +1: +Y yönünde (B ucu)."""
        add_line(np.abs(yy - baseline_y) < line_w)
        add_line((np.abs(yy - free_throw_y) < line_w) & (np.abs(xx) < KEY_HALF_WIDTH + line_w))

        y_lo, y_hi = sorted([baseline_y, free_throw_y])
        add_line((np.abs(xx - KEY_HALF_WIDTH) < line_w) & (yy <= y_hi) & (yy >= y_lo))
        add_line((np.abs(xx + KEY_HALF_WIDTH) < line_w) & (yy <= y_hi) & (yy >= y_lo))

        dist_ft = np.sqrt(xx ** 2 + (yy - free_throw_y) ** 2)
        ft_cond = (yy <= free_throw_y) if sign < 0 else (yy >= free_throw_y)
        add_line((np.abs(dist_ft - CIRCLE_RADIUS) < line_w) & ft_cond)

        dist_3p = np.sqrt(xx ** 2 + (yy - basket_y) ** 2)
        bl_cond = (yy <= baseline_y) if sign < 0 else (yy >= baseline_y)
        add_line((np.abs(dist_3p - THREE_POINT_RADIUS) < line_w) & bl_cond)

        # Kısıtlı alan yayı (potanın altındaki "no-charge" yarım çemberi)
        dist_restricted = np.sqrt(xx ** 2 + (yy - basket_y) ** 2)
        restricted_cond = bl_cond & (np.abs(xx) < KEY_HALF_WIDTH + 0.3)
        add_line((np.abs(dist_restricted - RESTRICTED_RADIUS) < line_w) & restricted_cond)

        # Ribaund pozisyon çizgileri (lane çizgisinden dışa taşan kısa çentikler)
        tick_len = 0.15
        for frac in (0.35, 0.55, 0.75):
            hy = baseline_y + (free_throw_y - baseline_y) * frac
            add_line((np.abs(yy - hy) < line_w) & (xx > KEY_HALF_WIDTH - 0.01) & (xx < KEY_HALF_WIDTH + tick_len))
            add_line((np.abs(yy - hy) < line_w) & (xx < -KEY_HALF_WIDTH + 0.01) & (xx > -KEY_HALF_WIDTH - tick_len))

    add_end_markings(BASKET_A_Y, BASELINE_A_Y, FREE_THROW_A_Y, sign=-1)
    add_end_markings(BASKET_B_Y, BASELINE_B_Y, FREE_THROW_B_Y, sign=+1)

    # Sınır çizgileri (sideline'lar, tam saha boyunca)
    add_line(np.abs(xx - SIDELINE_X) < line_w)
    add_line(np.abs(xx + SIDELINE_X) < line_w)

    # Orta saha çizgisi + orta yuvarlak
    add_line(np.abs(yy - MIDLINE_Y) < line_w)
    dist_center = np.sqrt(xx ** 2 + (yy - MIDLINE_Y) ** 2)
    add_line(np.abs(dist_center - CIRCLE_RADIUS) < line_w)

    rgba = np.zeros((size_y, size_x, 4), dtype=np.float32)
    for c in range(3):
        rgba[..., c] = rgb[..., c] * (1.0 - lines) + lines * 0.95
    rgba[..., 3] = 1.0

    img = bpy.data.images.new("court_albedo", width=size_x, height=size_y, alpha=True)
    img.pixels = rgba.flatten().tolist()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return path


def make_floor_material(image_path):
    mat = bpy.data.materials.new(name="M_Court")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(image_path)
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


def create_floor():
    width = FLOOR_X_MAX - FLOOR_X_MIN
    length = FLOOR_Y_MAX - FLOOR_Y_MIN
    cx = (FLOOR_X_MIN + FLOOR_X_MAX) / 2
    cy = (FLOOR_Y_MIN + FLOOR_Y_MAX) / 2
    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cy, 0))
    obj = bpy.context.active_object
    obj.name = "Floor"
    obj.scale = (width / 2, length / 2, 1)
    bpy.ops.object.transform_apply(scale=True)

    tex_path = os.path.join(TEXTURES_DIR, "court_albedo.png")
    create_court_texture(tex_path)
    mat = make_floor_material(tex_path)
    obj.data.materials.append(mat)

    # UV: düzlemsel üstten bakı, plane varsayılan UV'si zaten 0-1 kare şeklinde geliyor.
    return obj


def export_fbx(filepath):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.fbx(
        filepath=filepath,
        use_selection=True,
        global_scale=1.0,
        apply_unit_scale=True,
        apply_scale_options='FBX_SCALE_ALL',
        axis_forward='-Z',
        axis_up='Y',
        object_types={'MESH'},
        use_mesh_modifiers=True,
        mesh_smooth_type='FACE',
        bake_anim=False,
    )


def main():
    clear_scene()
    setup_units()
    create_floor()
    out_path = os.path.join(MODELS_DIR, "Court.fbx")
    export_fbx(out_path)
    print(f"[OK] Court export edildi: {out_path}")
    print(f"     Hoop A Y={BASKET_A_Y:.3f}  Hoop B Y={BASKET_B_Y:.3f}  Court length={COURT_LENGTH}")


if __name__ == "__main__":
    main()
