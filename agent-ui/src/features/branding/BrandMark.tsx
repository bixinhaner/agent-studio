import type { CSSProperties } from "react";

type BrandMarkProps = {
  name: string;
  logoUrl?: string;
  className?: string;
  imageClassName?: string;
  style?: CSSProperties;
};

export function getBrandInitials(name: string): string {
  const normalized = name.trim();
  if (!normalized) return "AI";
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 2).map((word) => Array.from(word)[0]?.toUpperCase() || "").join("");
  }
  return Array.from(normalized).slice(0, 2).join("").toUpperCase();
}

export function BrandMark({ name, logoUrl = "", className, imageClassName, style }: BrandMarkProps) {
  const src = logoUrl.trim();
  return (
    <span className={className} style={style} aria-hidden="true">
      {src ? <img className={imageClassName} src={src} alt="" loading="eager" /> : getBrandInitials(name)}
    </span>
  );
}
