import React from 'react';
import { LayoutGrid, Server, Settings } from 'lucide-react';
import { clsx } from 'clsx';
import logoUrl from '../../../assets/logo.png';

interface SidebarProps {
  activeView: 'clusters' | 'dashboard' | 'settings';
  onChangeView: (view: 'clusters' | 'dashboard' | 'settings') => void;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({ activeView, onChangeView }) => {
  return (
    <div className="w-16 h-full bg-transparent flex flex-col items-center py-4 border-r border-white/5">
      <div className="mb-8">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden">
          <img
            src={logoUrl}
            alt="Lumen Logo"
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 w-full px-2">
        <NavButton
          icon={<Server size={24} />}
          active={activeView === 'clusters'}
          onClick={() => onChangeView('clusters')}
          label="Clusters"
        />
        <NavButton
          icon={<LayoutGrid size={24} />}
          active={activeView === 'dashboard'}
          onClick={() => onChangeView('dashboard')}
          label="Resources"
        />
      </div>

      <div className="mt-auto mb-4">
        <NavButton
          icon={<Settings size={24} />}
          active={activeView === 'settings'}
          onClick={() => onChangeView('settings')}
          label="Settings"
        />
      </div>
    </div>
  );
});

const NavButton = ({ icon, active, onClick, label }: any) => (
  <button
    onClick={onClick}
    className={clsx(
      "w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-200 group relative",
      active ? "bg-white/10 text-blue-400" : "text-gray-400 hover:text-white hover:bg-white/5"
    )}
  >
    {icon}
    <span className="absolute left-14 bg-[#333] px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
      {label}
    </span>
  </button>
);
