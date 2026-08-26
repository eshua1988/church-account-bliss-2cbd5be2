import { cn } from '@/lib/utils';

interface CloudSyncIconProps {
  className?: string;
}

export const CloudSyncIcon = ({ className }: CloudSyncIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn('h-5 w-5', className)}
    aria-hidden="true"
  >
    <path d="M6.2 17.5H5a3.5 3.5 0 0 1-.6-6.95A6.5 6.5 0 0 1 16.8 8.6 4.5 4.5 0 0 1 19 17h-1.2" />
    <path d="M8 14.2a4.6 4.6 0 0 1 7.55-1.65" />
    <path d="m15.5 10.2.15 2.55-2.55.15" />
    <path d="M16 16.8a4.6 4.6 0 0 1-7.55 1.65" />
    <path d="m8.5 20.8-.15-2.55 2.55-.15" />
  </svg>
);
