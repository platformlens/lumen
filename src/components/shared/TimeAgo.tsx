import React, { useEffect, useState } from 'react';

export type DateFormatPreset = 'uk' | 'eu' | 'us' | 'iso';

const DATE_FORMAT_KEY = 'lumen_dateFormat';

/** Read the user's preferred date format from localStorage */
function getDateFormat(): DateFormatPreset {
    try {
        const stored = localStorage.getItem(DATE_FORMAT_KEY);
        if (stored === 'uk' || stored === 'eu' || stored === 'us' || stored === 'iso') return stored;
    } catch { /* ignore */ }
    return 'uk';
}

/** Format a date according to the user's chosen preset */
function formatDate(date: Date, format: DateFormatPreset): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    switch (format) {
        case 'uk': return `${dd}/${mm}/${yyyy}`;
        case 'eu': return `${dd}.${mm}.${yyyy}`;
        case 'us': return `${mm}/${dd}/${yyyy}`;
        case 'iso': return `${yyyy}-${mm}-${dd}`;
    }
}

interface TimeAgoProps {
    timestamp: string | number | Date;
}

export const TimeAgo: React.FC<TimeAgoProps> = ({ timestamp }) => {
    const [label, setLabel] = useState('');

    useEffect(() => {
        const update = () => {
            const date = new Date(timestamp);
            const now = new Date();
            const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

            if (diffInSeconds < 0) {
                setLabel('0s');
                return;
            }

            // After 48 hours, show formatted date
            if (diffInSeconds > 172800) {
                setLabel(formatDate(date, getDateFormat()));
            } else if (diffInSeconds < 60) {
                setLabel(`${diffInSeconds}s`);
            } else if (diffInSeconds < 3600) {
                setLabel(`${Math.floor(diffInSeconds / 60)}m`);
            } else if (diffInSeconds < 86400) {
                setLabel(`${Math.floor(diffInSeconds / 3600)}h`);
            } else {
                // Between 24 and 48 hours
                const days = Math.floor(diffInSeconds / 86400);
                const hours = Math.floor((diffInSeconds % 86400) / 3600);
                setLabel(`${days}d${hours}h`);
            }
        };

        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [timestamp]);

    return <span>{label}</span>;
};
