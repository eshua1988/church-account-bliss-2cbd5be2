import { Button } from '@/components/ui/button';
import { Undo2, Redo2 } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface UndoRedoControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export const UndoRedoControls = ({ canUndo, canRedo, onUndo, onRedo }: UndoRedoControlsProps) => {
  const { t } = useTranslation();

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onUndo}
              disabled={!canUndo}
              className="h-9 w-9"
            >
              <Undo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('undo')} (Ctrl+Z)</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onRedo}
              disabled={!canRedo}
              className="h-9 w-9"
            >
              <Redo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('redo')} (Ctrl+Y)</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};
