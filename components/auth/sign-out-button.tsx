"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// Nút đăng xuất
export function SignOutButton() {
  const router = useRouter();

  const handleSignOut = async () => {
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleSignOut}
      className="h-9 px-4 rounded-full text-[12px] font-bold"
    >
      Đăng xuất
    </Button>
  );
}
