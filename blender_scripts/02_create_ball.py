"""
BASKETBOL TOPU MODELI - Blender Python Script
Headless çalıştırma: blender --background --python 02_create_ball.py

Üretir:
  - Assets/Models/Ball.fbx
  - Assets/Textures/ball_albedo.png (turuncu + dikiş çizgileri dokusu)
"""

import bpy
import bmesh
import math
import os
import numpy as np

PROJECT_ROOT = "/Users/ILERISOY/basketball-game"
MODELS_DIR = os.path.join(PROJECT_ROOT, "Assets", "Models")
TEXTURES_DIR = os.path.join(PROJECT_ROOT, "Assets", "Textures")
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(TEXTURES_DIR, exist_ok=True)

BALL_RADIUS = 0.1213  # resmi basketbol topu çapı ~24.26cm / 2


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


def create_ball_albedo_texture(path, size=1024):
    """Equirectangular UV üzerine turuncu zemin + siyah dikiş çizgileri."""
    u = np.linspace(0, 1, size, endpoint=False)
    v = np.linspace(0, 1, size, endpoint=False)
    uu, vv = np.meshgrid(u, v)

    base_orange = np.array([0.80, 0.36, 0.08])
    pebble_noise = (np.sin(uu * 220.0) * np.sin(vv * 220.0)) * 0.025

    rgb = np.zeros((size, size, 3), dtype=np.float32)
    for c in range(3):
        rgb[..., c] = base_orange[c] + pebble_noise

    seam = np.zeros((size, size), dtype=np.float32)
    line_w = 0.012

    # iki dikey ana dikiş (boylam çizgileri)
    for cx in (0.25, 0.75):
        d = np.minimum(np.abs(uu - cx), 1.0 - np.abs(uu - cx))
        seam = np.maximum(seam, (d < line_w).astype(np.float32))

    # ekvator dikişi (enlem çizgisi)
    d_eq = np.abs(vv - 0.5)
    seam = np.maximum(seam, (d_eq < line_w).astype(np.float32))

    # iki kavisli yan dikiş (klasik basketbol panel eğrisi)
    for phase in (0.0, 0.5):
        curve = 0.5 + 0.16 * np.sin((uu + phase) * 2 * math.pi)
        d_curve = np.abs(vv - curve)
        seam = np.maximum(seam, (d_curve < line_w).astype(np.float32))

    rgba = np.zeros((size, size, 4), dtype=np.float32)
    for c in range(3):
        rgba[..., c] = rgb[..., c] * (1.0 - seam)  # dikiş yerinde siyaha çek
    rgba[..., 3] = 1.0

    img = bpy.data.images.new("ball_albedo", width=size, height=size, alpha=True)
    img.pixels = rgba.flatten().tolist()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return path


def make_ball_material(image_path):
    mat = bpy.data.materials.new(name="M_Ball")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(image_path)
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs['Roughness'].default_value = 0.75
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


def create_ball():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=BALL_RADIUS, location=(0, 0, BALL_RADIUS))
    obj = bpy.context.active_object
    obj.name = "Ball"
    bpy.ops.object.shade_smooth()

    # primitive_uv_sphere_add varsayılan UV'si zaten equirectangular (boylam/enlem)
    # düzende geldiği için dikiş dokusu hesaplamasıyla birebir örtüşüyor.

    albedo_path = os.path.join(TEXTURES_DIR, "ball_albedo.png")
    create_ball_albedo_texture(albedo_path)
    mat = make_ball_material(albedo_path)
    obj.data.materials.append(mat)
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
    create_ball()
    out_path = os.path.join(MODELS_DIR, "Ball.fbx")
    export_fbx(out_path)
    print(f"[OK] Ball export edildi: {out_path}")


if __name__ == "__main__":
    main()
