interface ProgressionArrowProps {
  className?: string;
}

export function ProgressionArrow({ className }: ProgressionArrowProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 10"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 5H20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M15.8 1.4L20.4 5L15.8 8.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
