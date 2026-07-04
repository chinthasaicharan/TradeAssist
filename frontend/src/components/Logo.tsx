interface Props {
  size?: number   // px
  className?: string
}

export function Logo({ size = 28, className = '' }: Props) {
  return (
    <img
      src="/logo.svg"
      width={size}
      height={size}
      alt="TradeAssist"
      className={`rounded-xl ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
