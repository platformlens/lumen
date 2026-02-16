import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';

export interface ToggleOption<T extends string> {
    value: T;
    label: ReactNode;
    icon?: LucideIcon;
}

interface ToggleGroupProps<T extends string> {
    options: ToggleOption<T>[];
    value: T;
    onChange: (value: T) => void;
    className?: string;
    prefix?: ReactNode; // For things like Refresh button or separators
}

export const ToggleGroup = <T extends string>({
    options,
    value,
    onChange,
    className,
    prefix
}: ToggleGroupProps<T>) => {
    return (
        <div className={clsx(
            "flex bg-black/40 p-1 rounded-lg border border-white/10 backdrop-blur-md gap-2",
            className
        )}>
            {prefix}

            {options.map((option) => {
                const isActive = value === option.value;
                const Icon = option.icon;

                return (
                    <button
                        key={option.value}
                        onClick={() => onChange(option.value)}
                        className={clsx(
                            "px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all relative",
                            isActive
                                ? "text-white shadow-lg border border-white/10 bg-white/10"
                                : "text-gray-400 hover:text-white border border-transparent"
                        )}
                    >
                        {isActive && (
                            <motion.div
                                layoutId="toggle-bg"
                                className="absolute inset-0 bg-white/10 rounded-md -z-10"
                                initial={false}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        )}
                        {Icon && <Icon size={12} />}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
};
