interface SkeletonProps {
  className?: string
  rows?: number
}

export function Skeleton({ className = '', rows = 1 }: SkeletonProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`animate-pulse bg-gray-800 rounded ${className}`}
          style={{ height: '1rem' }}
        />
      ))}
    </div>
  )
}

export function PanelSkeleton() {
  return (
    <div className="panel">
      <div className="animate-pulse space-y-3">
        <div className="h-3 bg-gray-800 rounded w-1/3" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-800 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
