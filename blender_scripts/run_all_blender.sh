#!/bin/bash
# ============================================================
#  BASKETBALL SHOTS — BLENDER MODEL ÜRETİM SCRIPTİ
#  Tüm 3D modelleri (pota, top, saha, stadyum) tek seferde üretir
# ============================================================

BLENDER="blender"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v "$BLENDER" >/dev/null 2>&1; then
    echo "[HATA] Blender bulunamadı (PATH içinde 'blender' komutu yok)."
    exit 1
fi

echo "================================================"
echo "  Basketball Shots — 3D Model Üretimi Başlıyor"
echo "================================================"

echo ""
echo "[1/5] Pota (hoop) oluşturuluyor..."
"$BLENDER" --background --python "$SCRIPTS_DIR/01_create_hoop.py"

echo ""
echo "[2/5] Top (ball) oluşturuluyor..."
"$BLENDER" --background --python "$SCRIPTS_DIR/02_create_ball.py"

echo ""
echo "[3/5] Saha (court) oluşturuluyor..."
"$BLENDER" --background --python "$SCRIPTS_DIR/03_create_court.py"

echo ""
echo "[4/5] Stadyum (tribün+seyirci+reklam panoları) oluşturuluyor..."
"$BLENDER" --background --python "$SCRIPTS_DIR/04_create_stadium.py"

echo ""
echo "[5/5] Oyuncu (player) modeli oluşturuluyor..."
"$BLENDER" --background --python "$SCRIPTS_DIR/05_create_players.py"

echo ""
echo "================================================"
echo "  Tüm modeller tamamlandı!"
echo "  Konum: Assets/Models/  ve  Assets/Textures/"
echo "================================================"
