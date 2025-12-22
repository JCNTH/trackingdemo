"""
Rule-based bench press form analysis.

Analyzes pose data and video metrics to provide:
- Form quality assessment based on bar path verticality
- Elbow symmetry analysis
- Basic recommendations

This is a simplified version that uses rule-based logic instead of AI.
"""

import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


def analyze_bench_press(
    trajectory_data: Dict,
    velocity_metrics: Dict,
    joint_angles: List[Dict],
    tracking_stats: Dict,
    video_info: Dict,
) -> Dict:
    """
    Analyze bench press form using rule-based metrics.
    
    Scoring criteria:
    - Path verticality > 0.7: +10 points (good bar control)
    - Path verticality < 0.4: -10 points (excessive horizontal movement)
    - Elbow asymmetry < 10°: +5 points (good symmetry)
    - Elbow asymmetry > 20°: -10 points (significant imbalance)
    - Tracking quality > 90%: +5 points (reliable data)
    
    Args:
        trajectory_data: Bar path trajectory points
        velocity_metrics: Velocity-based metrics
        joint_angles: Joint angle measurements per frame
        tracking_stats: Tracking source breakdown
        video_info: Video metadata
        
    Returns:
        Form analysis with score, quality, and recommendations
    """
    # Extract metrics
    path_verticality = velocity_metrics.get("path_verticality", 0)
    horizontal_dev = velocity_metrics.get("horizontal_deviation", 0)
    vertical_disp = velocity_metrics.get("vertical_displacement", 0)
    
    # Calculate average elbow asymmetry
    elbow_asymmetries = []
    if joint_angles:
        for angles in joint_angles:
            asym = angles.get("elbow_asymmetry", 0)
            if asym:
                elbow_asymmetries.append(asym)
    
    avg_asymmetry = sum(elbow_asymmetries) / len(elbow_asymmetries) if elbow_asymmetries else 0
    
    # Start with base score
    score = 70
    issues = []
    strengths = []
    
    # ===== BAR PATH SCORING =====
    if path_verticality > 0.7:
        score += 10
        strengths.append("Good bar path control - minimal horizontal drift")
    elif path_verticality < 0.4:
        score -= 10
        issues.append("Bar path has excessive horizontal movement")
    
    # ===== ELBOW SYMMETRY SCORING =====
    if avg_asymmetry < 10:
        score += 5
        strengths.append("Good elbow symmetry between left and right")
    elif avg_asymmetry > 20:
        score -= 10
        issues.append(f"Elbow asymmetry detected ({avg_asymmetry:.1f}° average difference)")
    
    # ===== TRACKING QUALITY =====
    total_frames = sum(tracking_stats.values())
    if total_frames > 0:
        both_wrists_pct = tracking_stats.get("both_wrists", 0) / total_frames
        if both_wrists_pct > 0.9:
            strengths.append("Excellent tracking quality - reliable data")
        elif both_wrists_pct < 0.5:
            issues.append("Tracking was inconsistent - some data may be unreliable")
    
    # ===== DETERMINE FORM QUALITY =====
    if score >= 85:
        form_quality = "excellent"
    elif score >= 70:
        form_quality = "good"
    elif score >= 55:
        form_quality = "fair"
    else:
        form_quality = "needs_work"
    
    return {
        "overall_score": min(100, max(0, score)),
        "form_quality": form_quality,
        "summary": f"Form analysis based on bar path and joint angles. Score: {score}/100.",
        "bar_path_analysis": {
            "quality": "good" if path_verticality > 0.6 else "fair" if path_verticality > 0.4 else "poor",
            "verticality": path_verticality,
            "horizontal_deviation_px": horizontal_dev,
            "vertical_displacement_px": vertical_disp,
            "issues": [i for i in issues if "bar path" in i.lower()],
            "recommendations": [
                "Focus on controlling the bar path throughout the lift",
                "Keep your shoulder blades pinched together",
            ] if path_verticality < 0.6 else [],
        },
        "elbow_analysis": {
            "symmetry": "good" if avg_asymmetry < 15 else "fair" if avg_asymmetry < 25 else "poor",
            "average_asymmetry_degrees": round(avg_asymmetry, 1),
            "issues": [i for i in issues if "elbow" in i.lower()],
        },
        "strengths": strengths,
        "improvements": [
            {
                "area": issue,
                "priority": "high" if "asymmetry" in issue.lower() else "medium",
                "suggestion": "Work on this aspect during warm-up sets"
            }
            for issue in issues
        ],
        "coaching_cues": [
            "Drive through your feet",
            "Keep your wrists straight",
            "Control the descent",
        ],
    }
