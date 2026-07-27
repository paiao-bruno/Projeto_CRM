"use client";

import { isFeatureEnabled, type FeatureFlagKey } from "@/lib/feature-flags";
import { UnavailableFeature } from "@/components/unavailable-feature";

export function FeatureGate({
  feature,
  title,
  children,
}: {
  feature: FeatureFlagKey;
  title: string;
  children: React.ReactNode;
}) {
  if (!isFeatureEnabled(feature)) {
    return (
      <UnavailableFeature
        title={title}
        description="Funcionalidade indisponível neste ambiente. Ela só aparece no menu quando a feature flag correspondente estiver habilitada explicitamente."
      />
    );
  }

  return <>{children}</>;
}
