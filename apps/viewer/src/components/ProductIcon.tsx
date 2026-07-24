import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";

export function ProductIcon({
  size = 16,
  strokeWidth = 1.5,
  color = "currentColor",
  "aria-hidden": ariaHidden = true,
  ...props
}: HugeiconsIconProps) {
  return (
    <HugeiconsIcon
      {...props}
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      aria-hidden={ariaHidden}
      focusable={false}
    />
  );
}
