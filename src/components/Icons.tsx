import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function IconBase({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4A.8.8 0 0 0 8 5.6Z" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function PauseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function StepIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 5.8v12.4a.7.7 0 0 0 1.1.6l8-6.2a.8.8 0 0 0 0-1.2l-8-6.2a.7.7 0 0 0-1.1.6Z" fill="currentColor" stroke="none" />
      <path d="M18 5.5v13" />
    </IconBase>
  )
}

export function ResetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 10a7.8 7.8 0 1 1 1.1 6.1" />
      <path d="M4.4 5.5V10h4.5" />
    </IconBase>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  )
}

export function ImportIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
      <path d="M5 15.5v3A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-3" />
    </IconBase>
  )
}

export function ExportIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 14V4m0 0 4 4m-4-4L8 8" />
      <path d="M5 15.5v3A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-3" />
    </IconBase>
  )
}

export function UndoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 7 5 11l4 4" />
      <path d="M5.5 11H14a5 5 0 0 1 0 10h-2" />
    </IconBase>
  )
}

export function RedoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m15 7 4 4-4 4" />
      <path d="M18.5 11H10a5 5 0 0 0 0 10h2" />
    </IconBase>
  )
}

export function BookIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 5.8A2.3 2.3 0 0 1 6.8 3.5H19v15.2H6.8a2.3 2.3 0 0 0-2.3 2.3Z" />
      <path d="M4.5 5.8v15.2M8 7.5h6.5M8 11h4.5" />
    </IconBase>
  )
}

export function GridIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
    </IconBase>
  )
}

export function ToolboxIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 8.8A1.8 1.8 0 0 1 5.8 7h12.4A1.8 1.8 0 0 1 20 8.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.2Z" />
      <path d="M9 7V5.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6V7M4 12h16" />
    </IconBase>
  )
}

export function SlidersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 6h7M15 6h5M4 12h3M11 12h9M4 18h10M18 18h2" />
      <circle cx="13" cy="6" r="2" fill="#fff" />
      <circle cx="9" cy="12" r="2" fill="#fff" />
      <circle cx="16" cy="18" r="2" fill="#fff" />
    </IconBase>
  )
}

export function TagIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 5.8A1.8 1.8 0 0 1 5.8 4h5.4c.5 0 1 .2 1.3.6l7 7a1.8 1.8 0 0 1 0 2.5l-5.4 5.4a1.8 1.8 0 0 1-2.5 0l-7-7a1.8 1.8 0 0 1-.6-1.3Z" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.3 12.1 2.4 2.4 5-5" />
    </IconBase>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </IconBase>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </IconBase>
  )
}

export function LadderIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 4v16M4 12h5M9 8v8M15 8v8M15 12h5M20 4v16" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function InfoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 10.5V17M12 7.4v.2" />
    </IconBase>
  )
}

export function HelpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.2a2.7 2.7 0 1 1 4 2.4c-.9.5-1.4 1-1.4 2.1" />
      <circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function BoltIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M13.2 2.8 5 13.4h5.4L10 21.2l8.3-10.7h-5.5l.4-7.7Z" />
    </IconBase>
  )
}

export function LayersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m12 3 8.5 4.7L12 12.4 3.5 7.7 12 3ZM3.5 12.2l8.5 4.7 8.5-4.7M3.5 16.7l8.5 4.7 8.5-4.7" />
    </IconBase>
  )
}

export function PointerIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5.5 3.8 18.5 11l-5.9 1.7-2.6 5.7L5.5 3.8Z" />
    </IconBase>
  )
}

export function ToggleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="7" width="18" height="10" rx="5" />
      <circle cx="16" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 12h15m-5.5-5.5L19 12l-5.5 5.5" />
    </IconBase>
  )
}

/** 打开分支：主线路末尾向下分出一条支路。 */
export function BranchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 6h18" />
      <path d="M8 6v9a4 4 0 0 0 4 4h9" />
    </IconBase>
  )
}

export function GripIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </IconBase>
  )
}

export function MoreIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </IconBase>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.2 4.2" />
    </IconBase>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 9 6 6 6-6" />
    </IconBase>
  )
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 19V5m0 0L6.5 10.5M12 5l5.5 5.5" />
    </IconBase>
  )
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14m0 0 5.5-5.5M12 19l-5.5-5.5" />
    </IconBase>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="8" y="8" width="12" height="12" rx="1.8" />
      <path d="M16 8V5.8A1.8 1.8 0 0 0 14.2 4H5.8A1.8 1.8 0 0 0 4 5.8v8.4A1.8 1.8 0 0 0 5.8 16H8" />
    </IconBase>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 7h15M9 7V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8V7M6.5 7l.9 12.2A1.4 1.4 0 0 0 8.8 20.5h6.4a1.4 1.4 0 0 0 1.4-1.3L17.5 7M10 11v5.5M14 11v5.5" />
    </IconBase>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.8 7.2A1.8 1.8 0 0 1 5.6 5.4h4l1.8 2h7A1.8 1.8 0 0 1 20.2 9v7.8a1.8 1.8 0 0 1-1.8 1.8H5.6a1.8 1.8 0 0 1-1.8-1.8Z" />
    </IconBase>
  )
}

export function CpuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.8" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </IconBase>
  )
}
