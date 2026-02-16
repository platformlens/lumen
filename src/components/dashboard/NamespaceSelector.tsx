import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { clsx } from 'clsx';

interface NamespaceSelectorProps {
  namespaces: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export const NamespaceSelector: React.FC<NamespaceSelectorProps> = ({ namespaces, selected, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (ns: string) => {
    if (ns === 'all') {
      onChange(['all']);
    } else {
      let newSelected = selected.filter(s => s !== 'all');
      if (newSelected.includes(ns)) {
        newSelected = newSelected.filter(s => s !== ns);
      } else {
        newSelected = [...newSelected, ns];
      }
      
      if (newSelected.length === 0) {
        newSelected = ['all'];
      }
      onChange(newSelected);
    }
  };

  const filteredNamespaces = namespaces.filter(ns => 
    ns.toLowerCase().includes(search.toLowerCase())
  );

  const isAllSelected = selected.includes('all');

  return (
    <div className="relative w-72" ref={dropdownRef}>
        <div 
          className="bg-[#1e1e1e] border border-[#333] hover:border-[#555] rounded-md px-3 py-2 cursor-pointer flex justify-between items-center transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="flex gap-1 overflow-hidden">
            {isAllSelected ? (
              <span className="text-gray-300 text-sm">All Namespaces</span>
            ) : (
               <div className="flex gap-1 overflow-hidden max-w-[200px]">
                 {selected.map(ns => (
                   <span key={ns} className="bg-blue-500/20 text-blue-400 text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                     {ns}
                   </span>
                 ))}
               </div>
            )}
            {!isAllSelected && selected.length === 0 && <span className="text-gray-500 text-sm">Select Namespace...</span>}
          </div>
          <ChevronDown size={16} className={clsx("text-gray-500 transition-transform", isOpen && "rotate-180")} />
        </div>

        {isOpen && (
            <div className="absolute top-full left-0 w-full mt-1 bg-[#252526] border border-[#333] rounded-md shadow-xl z-[100] max-h-96 flex flex-col">
                <div className="p-2 border-b border-[#333]">
                    <input 
                        type="text" 
                        placeholder="Filter namespaces..." 
                        className="w-full bg-[#1e1e1e] border border-[#444] rounded px-2 py-1 text-sm text-gray-200 outline-none focus:border-blue-500"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        autoFocus
                    />
                </div>
                <div className="overflow-y-auto flex-1 p-1">
                   <div 
                      className={clsx(
                        "px-2 py-1.5 rounded cursor-pointer flex items-center justify-between text-sm",
                        isAllSelected ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-[#333]"
                      )}
                      onClick={() => handleSelect('all')}
                   >
                     <span>All Namespaces</span>
                     {isAllSelected && <Check size={14} />}
                   </div>
                   
                   {filteredNamespaces.length > 0 && <div className="h-px bg-[#333] my-1 mx-2"></div>}

                   {filteredNamespaces.map(ns => {
                     const isSelected = selected.includes(ns);
                     return (
                       <div 
                          key={ns}
                          className={clsx(
                            "px-2 py-1.5 rounded cursor-pointer flex items-center justify-between text-sm transition-colors",
                            isSelected ? "bg-[#333] text-blue-400" : "text-gray-300 hover:bg-[#333]"
                          )}
                          onClick={() => handleSelect(ns)}
                       >
                         <span>{ns}</span>
                         {isSelected && <Check size={14} />}
                       </div>
                     );
                   })}
                </div>
            </div>
        )}
    </div>
  );
}
