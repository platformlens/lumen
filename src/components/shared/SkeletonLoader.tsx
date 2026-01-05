import React from 'react';

export const SkeletonLoader: React.FC = () => {
    return (
        <div className="w-full h-full flex flex-col gap-4 p-4 animate-pulse">
            {[...Array(10)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                    <div className="h-8 bg-white/5 rounded w-1/4"></div>
                    <div className="h-8 bg-white/5 rounded w-1/4"></div>
                    <div className="h-8 bg-white/5 rounded w-1/6"></div>
                    <div className="h-8 bg-white/5 rounded w-1/6"></div>
                    <div className="h-8 bg-white/5 rounded w-1/6"></div>
                </div>
            ))}
        </div>
    );
};
