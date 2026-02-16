export const StatusBadge = ({ condition }: { condition: boolean }) => (
    <span className={`px-2 py-0.5 rounded text-xs ${condition ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
        {condition ? 'Active' : 'Pending'}
    </span>
)
