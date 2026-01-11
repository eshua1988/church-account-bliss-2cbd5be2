import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Plus, Pencil, X, Check } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';

interface DepartmentManagerProps {
  departments: string[];
  onAdd: (name: string) => boolean;
  onDelete: (name: string) => void;
  onUpdate: (oldName: string, newName: string) => void;
}

export const DepartmentManager = ({ departments, onAdd, onDelete, onUpdate }: DepartmentManagerProps) => {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = () => {
    if (onAdd(newName)) {
      setNewName('');
    }
  };

  const startEdit = (name: string) => {
    setEditingName(name);
    setEditValue(name);
  };

  const saveEdit = () => {
    if (editingName && editValue.trim()) {
      onUpdate(editingName, editValue);
      setEditingName(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('enterDepartmentName')}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button onClick={handleAdd} size="icon" variant="outline">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        {departments.map((name) => (
          <div key={name} className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
            {editingName === name ? (
              <>
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 h-8"
                  autoFocus
                />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={saveEdit}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingName(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{name}</span>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(name)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(name)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
