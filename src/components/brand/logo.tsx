import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/ui/cn";

/**
 * AfterKey brand assets, extracted from the official logo.
 *
 * The mark is a dark-navy/blue "A" with a key silhouette; the wordmark is
 * two-tone ("After" deep navy, "Key" bright blue). On navy backgrounds we use
 * the light variants (white "After", blue "Key") and seat the mark on a white
 * chip so its dark stroke stays legible — same treatment the favicon uses.
 */

interface LogoProps {
  className?: string;
  /** Render on a navy/dark background (uses light wordmark variants). */
  onDark?: boolean;
  /** Accessible label; pass "" only when an adjacent heading already names the brand. */
  label?: string;
}

/** The A + key mark alone. */
export function BrandMark({ className, onDark = false, label = "AfterKey" }: LogoProps) {
  const image = (
    <Image
      src="/afterkey-mark.png"
      alt={label}
      width={68}
      height={50}
      priority={false}
      className={cn("h-[1.15em] w-auto", className)}
      style={{ height: "1.35em", width: "auto" }}
    />
  );

  if (!onDark) return image;

  // Dark stroke needs a light seat on navy backgrounds.
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md bg-white px-1.5 py-1 shadow-sm",
        className,
      )}
    >
      {image}
    </span>
  );
}

/** Full horizontal lockup: mark + wordmark image. */
export function BrandLockup({
  className,
  onDark = false,
  label = "AfterKey",
  href = "/",
  markClassName,
  wordmarkClassName,
}: LogoProps & { href?: string; markClassName?: string; wordmarkClassName?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn("inline-flex items-center gap-2.5", className)}
      data-interactive
    >
      <BrandMark onDark={onDark} label="" className={markClassName} />
      <Image
        src={onDark ? "/afterkey-wordmark-light.png" : "/afterkey-wordmark.png"}
        alt=""
        width={216}
        height={46}
        className={cn("h-[1.35rem] w-auto sm:h-[1.5rem]", wordmarkClassName)}
        priority={false}
      />
    </Link>
  );
}

/** Square app-icon style logo (mark on white), for avatars and placeholders. */
export function BrandIcon({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn("inline-flex items-center justify-center overflow-hidden rounded-lg border border-line bg-white", className)}
      style={{ width: size, height: size }}
    >
      <Image src="/afterkey-mark.png" alt="" width={size - 8} height={(size - 8) * 0.73} className="h-auto w-[78%]" />
    </span>
  );
}
