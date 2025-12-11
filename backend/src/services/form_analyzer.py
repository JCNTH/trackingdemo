"""
AI-powered bench press form analysis using Claude.

Analyzes pose data and video metrics to provide:
- Form quality assessment
- Technique issues and compensations
- Safety recommendations
- Improvement suggestions

Based on approach from medicly project.
"""
import os
import json
import logging
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# Try to import anthropic, but don't fail if not available
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    logger.warning("anthropic package not installed. LLM analysis will be disabled.")


class BenchPressFormAnalyzer:
    """
    AI-powered bench press form analyzer using Claude.
    
    Analyzes:
    - Bar path (should be slight arc, not straight up)
    - Elbow angles and symmetry
    - Wrist alignment
    - Rep tempo consistency
    - Compensatory patterns
    """
    
    def __init__(self):
        self.api_key = os.getenv('ANTHROPIC_API_KEY') or os.getenv('CLAUDE_API_KEY')
        self.model = "claude-haiku-4-5-20251001"  # Fast & efficient model (Haiku 4.5)
        self.client = None
        
        if ANTHROPIC_AVAILABLE and self.api_key:
            self.client = anthropic.Anthropic(api_key=self.api_key)
            logger.info("Claude client initialized for form analysis")
        else:
            if not ANTHROPIC_AVAILABLE:
                logger.warning("anthropic package not available")
            if not self.api_key:
                logger.warning("ANTHROPIC_API_KEY not set - LLM analysis disabled")
    
    def is_available(self) -> bool:
        """Check if LLM analysis is available."""
        return self.client is not None
    
    def analyze_bench_press_form(
        self,
        trajectory_data: Dict,
        velocity_metrics: Dict,
        joint_angles: List[Dict],
        tracking_stats: Dict,
        video_info: Dict,
    ) -> Dict:
        """
        Analyze bench press form using Claude.
        
        Args:
            trajectory_data: Bar path trajectory points
            velocity_metrics: Velocity-based metrics (peak, average, etc.)
            joint_angles: Joint angle measurements per frame
            tracking_stats: Tracking source breakdown
            video_info: Video metadata (fps, duration, etc.)
            
        Returns:
            Structured form analysis with recommendations
        """
        if not self.is_available():
            return self._create_fallback_analysis(
                velocity_metrics, joint_angles, tracking_stats
            )
        
        try:
            # Create analysis prompt
            prompt = self._create_form_analysis_prompt(
                trajectory_data,
                velocity_metrics,
                joint_angles,
                tracking_stats,
                video_info,
            )
            
            # Call Claude API
            start_time = datetime.now()
            response = self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}]
            )
            
            duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"Claude form analysis completed in {duration:.2f}s")
            
            # Parse response
            response_text = response.content[0].text
            analysis = self._parse_analysis_response(response_text)
            
            return {
                "success": True,
                "analysis": analysis,
                "model": self.model,
                "duration_seconds": duration,
                "timestamp": datetime.now().isoformat(),
            }
            
        except Exception as e:
            logger.error(f"Form analysis failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "analysis": self._create_fallback_analysis(
                    velocity_metrics, joint_angles, tracking_stats
                ),
                "timestamp": datetime.now().isoformat(),
            }
    
    def _create_form_analysis_prompt(
        self,
        trajectory_data: Dict,
        velocity_metrics: Dict,
        joint_angles: List[Dict],
        tracking_stats: Dict,
        video_info: Dict,
    ) -> str:
        """Create the analysis prompt for Claude."""
        
        # Summarize bar path
        bar_path = trajectory_data.get("bar_path", [])
        if bar_path:
            y_positions = [p["y"] for p in bar_path]
            x_positions = [p["x"] for p in bar_path]
            bar_path_summary = {
                "total_points": len(bar_path),
                "vertical_range": max(y_positions) - min(y_positions) if y_positions else 0,
                "horizontal_deviation": max(x_positions) - min(x_positions) if x_positions else 0,
                "start_position": bar_path[0] if bar_path else None,
                "end_position": bar_path[-1] if bar_path else None,
            }
        else:
            bar_path_summary = {"total_points": 0}
        
        # Summarize joint angles
        angle_summary = {}
        if joint_angles:
            for angle_data in joint_angles[-10:]:  # Last 10 frames
                for key in ["left_elbow", "right_elbow", "avg_elbow_angle", "elbow_asymmetry", "wrist_alignment"]:
                    if key in angle_data:
                        if key not in angle_summary:
                            angle_summary[key] = []
                        angle_summary[key].append(angle_data[key])
            
            # Calculate averages
            for key in angle_summary:
                values = angle_summary[key]
                angle_summary[key] = {
                    "mean": sum(values) / len(values) if values else 0,
                    "min": min(values) if values else 0,
                    "max": max(values) if values else 0,
                }
        
        prompt = f"""You are an expert strength coach and biomechanics specialist analyzing bench press form from video tracking data.

VIDEO INFORMATION:
- Duration: {video_info.get('duration', 0):.1f} seconds
- FPS: {video_info.get('fps', 30)}
- Resolution: {video_info.get('width', 0)}x{video_info.get('height', 0)}

VELOCITY METRICS:
- Peak concentric velocity: {velocity_metrics.get('peak_concentric_velocity', 0):.1f} px/s
- Peak eccentric velocity: {velocity_metrics.get('peak_eccentric_velocity', 0):.1f} px/s
- Average speed: {velocity_metrics.get('average_speed', 0):.1f} px/s
- Vertical displacement: {velocity_metrics.get('vertical_displacement', 0):.1f} px
- Horizontal deviation: {velocity_metrics.get('horizontal_deviation', 0):.1f} px
- Path verticality score: {velocity_metrics.get('path_verticality', 0)*100:.1f}%
- Estimated reps: {velocity_metrics.get('estimated_reps', 0)}

BAR PATH ANALYSIS:
{json.dumps(bar_path_summary, indent=2)}

JOINT ANGLES (averaged over frames):
{json.dumps(angle_summary, indent=2)}

TRACKING QUALITY:
- Both wrists visible: {tracking_stats.get('both_wrists', 0)} frames
- Single wrist fallback: {tracking_stats.get('single_wrist', 0)} frames
- Lost tracking: {tracking_stats.get('lost', 0)} frames

Please analyze this bench press performance and return a JSON response:

{{
  "overall_score": 85,
  "form_quality": "good",
  "summary": "Brief 1-2 sentence summary of overall form",
  "bar_path_analysis": {{
    "quality": "good|fair|poor",
    "issues": ["List any bar path issues"],
    "recommendations": ["How to improve bar path"]
  }},
  "elbow_analysis": {{
    "symmetry": "good|fair|poor",
    "angle_quality": "Elbow angle assessment",
    "issues": ["Any elbow-related issues"]
  }},
  "tempo_analysis": {{
    "eccentric_control": "good|fair|poor",
    "concentric_power": "good|fair|poor",
    "consistency": "Assessment of rep-to-rep consistency"
  }},
  "safety_concerns": ["List any safety issues"],
  "strengths": ["What the lifter is doing well"],
  "improvements": [
    {{
      "area": "What to improve",
      "priority": "high|medium|low",
      "suggestion": "How to improve it"
    }}
  ],
  "coaching_cues": ["Specific cues to give the lifter"]
}}

Focus on practical, actionable feedback. Be encouraging but honest about form issues.
Return ONLY valid JSON, no additional text."""

        return prompt
    
    def _parse_analysis_response(self, response_text: str) -> Dict:
        """Parse Claude's response into structured data."""
        try:
            # Clean response
            text = response_text.strip()
            
            # Extract JSON from markdown if present
            if "```json" in text:
                start = text.find("```json") + 7
                end = text.find("```", start)
                text = text[start:end].strip()
            elif "```" in text:
                start = text.find("```") + 3
                end = text.find("```", start)
                text = text[start:end].strip()
            
            return json.loads(text)
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude response: {e}")
            return {
                "overall_score": 70,
                "form_quality": "unknown",
                "summary": "Analysis completed but response parsing failed",
                "raw_response": response_text[:500],
            }
    
    def _create_fallback_analysis(
        self,
        velocity_metrics: Dict,
        joint_angles: List[Dict],
        tracking_stats: Dict,
    ) -> Dict:
        """Create rule-based analysis when LLM is unavailable."""
        
        # Calculate basic metrics
        path_verticality = velocity_metrics.get("path_verticality", 0)
        peak_velocity = velocity_metrics.get("peak_concentric_velocity", 0)
        horizontal_dev = velocity_metrics.get("horizontal_deviation", 0)
        vertical_disp = velocity_metrics.get("vertical_displacement", 0)
        
        # Analyze elbow symmetry
        elbow_asymmetries = []
        if joint_angles:
            for angles in joint_angles:
                asym = angles.get("elbow_asymmetry", 0)
                if asym:
                    elbow_asymmetries.append(asym)
        
        avg_asymmetry = sum(elbow_asymmetries) / len(elbow_asymmetries) if elbow_asymmetries else 0
        
        # Score calculation
        score = 70
        issues = []
        strengths = []
        
        # Bar path scoring
        if path_verticality > 0.7:
            score += 10
            strengths.append("Good bar path control")
        elif path_verticality < 0.4:
            score -= 10
            issues.append("Bar path has excessive horizontal movement")
        
        # Elbow symmetry scoring
        if avg_asymmetry < 10:
            score += 5
            strengths.append("Good elbow symmetry")
        elif avg_asymmetry > 20:
            score -= 10
            issues.append(f"Elbow asymmetry detected ({avg_asymmetry:.1f}° average difference)")
        
        # Tracking quality
        total_frames = sum(tracking_stats.values())
        if total_frames > 0:
            both_wrists_pct = tracking_stats.get("both_wrists", 0) / total_frames
            if both_wrists_pct > 0.9:
                strengths.append("Excellent tracking quality")
            elif both_wrists_pct < 0.5:
                issues.append("Tracking was inconsistent - some data may be unreliable")
        
        # Determine form quality
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
            "summary": f"Bench press form analysis based on tracking data. Score: {score}/100.",
            "bar_path_analysis": {
                "quality": "good" if path_verticality > 0.6 else "fair",
                "issues": [i for i in issues if "bar path" in i.lower()],
                "recommendations": [
                    "Focus on controlling the bar path throughout the lift",
                    "Keep your shoulder blades pinched together"
                ],
            },
            "elbow_analysis": {
                "symmetry": "good" if avg_asymmetry < 15 else "fair",
                "angle_quality": f"Average asymmetry: {avg_asymmetry:.1f}°",
                "issues": [i for i in issues if "elbow" in i.lower()],
            },
            "safety_concerns": [],
            "strengths": strengths,
            "improvements": [
                {
                    "area": issue,
                    "priority": "medium",
                    "suggestion": "Work on this aspect during warm-up sets"
                }
                for issue in issues
            ],
            "coaching_cues": [
                "Drive through your feet",
                "Keep your wrists straight",
                "Control the descent",
            ],
            "llm_available": False,
            "note": "This is a rule-based analysis. Set ANTHROPIC_API_KEY for AI-powered insights.",
        }


# Global instance
_analyzer: Optional[BenchPressFormAnalyzer] = None


def get_form_analyzer() -> BenchPressFormAnalyzer:
    """Get or create the form analyzer instance."""
    global _analyzer
    if _analyzer is None:
        _analyzer = BenchPressFormAnalyzer()
    return _analyzer


def analyze_bench_press(
    trajectory_data: Dict,
    velocity_metrics: Dict,
    joint_angles: List[Dict],
    tracking_stats: Dict,
    video_info: Dict,
) -> Dict:
    """
    Convenience function to analyze bench press form.
    
    Returns structured analysis with form quality, issues, and recommendations.
    """
    analyzer = get_form_analyzer()
    return analyzer.analyze_bench_press_form(
        trajectory_data=trajectory_data,
        velocity_metrics=velocity_metrics,
        joint_angles=joint_angles,
        tracking_stats=tracking_stats,
        video_info=video_info,
    )

