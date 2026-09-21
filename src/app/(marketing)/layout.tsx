"use client";

import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { PageFlipProvider, usePageFlip } from "@/context/PageFlipContext";
import { PageFlip3D } from "@/components/transitions/PageFlip3D";
import { LoginView } from "@/components/auth/LoginView";

function MarketingContentWithFlip({ children }: { children: React.ReactNode }) {
  const { flipToFront } = usePageFlip();

  const frontContent = (
    <>
      <MarketingNav />
      <div className="pt-16">{children}</div>
      <MarketingFooter />
    </>
  );

  return (
    <PageFlip3D
      front={frontContent}
      back={<LoginView onFlipBack={flipToFront} />}
    />
  );
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageFlipProvider>
      <MarketingContentWithFlip>{children}</MarketingContentWithFlip>
    </PageFlipProvider>
  );
}
