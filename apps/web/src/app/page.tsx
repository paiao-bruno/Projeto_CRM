"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { defaultLandingPath } from "@/lib/feature-flags";

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? defaultLandingPath(user.permissions) : "/login");
  }, [loading, router, user]);

  return null;
}
