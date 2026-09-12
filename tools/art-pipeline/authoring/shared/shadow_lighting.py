"""Shared cast-shadow projection, normalized by the caster's projected vertical height."""
import json
import math
from pathlib import Path

PROFILE_PATH = Path(__file__).resolve().parents[4] / 'docs/art/lighting.json'


def load_lighting():
    profile = json.loads(PROFILE_PATH.read_text())
    if profile['version'] != 1:
        raise ValueError('Unsupported world lighting profile')
    return profile


def screen_shadow_offset(profile):
    reference = profile['reference']
    elevation = math.radians(reference['cameraElevationDegrees'])
    azimuth = math.radians(reference['cameraAzimuthDegrees'])
    x, y, z = reference['sunIncomingDirection']
    if z >= 0:
        raise ValueError('Sun rays must point toward the ground')
    ground_x, ground_y = x / -z, y / -z
    right = math.cos(azimuth) * ground_x + math.sin(azimuth) * ground_y
    down = math.sin(elevation) * (math.sin(azimuth) * ground_x - math.cos(azimuth) * ground_y)
    return right / math.cos(elevation), down / math.cos(elevation)


def incoming_for_camera(right, up, profile):
    dx, dy = screen_shadow_offset(profile)
    determinant = right[1] * up[0] - right[0] * up[1]
    if abs(determinant) < 1e-8 or up[2] <= 0:
        raise ValueError('Shadow export requires an elevated camera with visible verticals')
    dx *= up[2]
    dy *= up[2]
    x = (-up[1] * dx - right[1] * dy) / determinant
    y = (up[0] * dx + right[0] * dy) / determinant
    return x, y, -1.0
