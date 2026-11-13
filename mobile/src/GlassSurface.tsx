import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View, ViewProps } from "react-native";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";

// Keep glass on controls and navigation; content stays on opaque readable surfaces.
export function GlassSurface({ children, style, dark, fallback, ...props }: ViewProps & {
  dark: boolean;
  fallback: string;
}) {
  const [opaque, setOpaque] = useState(true);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(value => {
      if (active) setOpaque(value);
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setOpaque);
    return () => { active = false; sub.remove(); };
  }, []);
  const available = Platform.OS === "ios" && !opaque && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  if (!available) return <View {...props} style={[style, { backgroundColor: fallback }]}>{children}</View>;
  return <GlassView {...props} glassEffectStyle="regular" colorScheme={dark ? "dark" : "light"} style={[styles.material, style]}>{children}</GlassView>;
}

const styles = StyleSheet.create({ material: { borderCurve: "continuous" } });
