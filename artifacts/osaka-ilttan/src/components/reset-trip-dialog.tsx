import { useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ResetTripDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="dialog-reset"
        onOpenAutoFocus={(e) => { e.preventDefault(); cancelRef.current?.focus(); }}
        className="w-[calc(100%-32px)] max-w-[420px] rounded-2xl border border-[hsl(218_30%_88%)] bg-white p-6 shadow-[0_20px_50px_-24px_hsl(224_50%_20%/.35)] sm:rounded-2xl [&>button]:size-11 [&>button]:right-2 [&>button]:top-2 [&>button]:grid [&>button]:place-items-center"
      >
        <DialogHeader className="text-left sm:text-left">
          <span className="grid place-items-center w-11 h-11 rounded-full bg-[hsl(218_80%_95%)] text-primary" aria-hidden><RotateCcw className="w-5 h-5" /></span>
          <p className="mt-4 text-[10px] font-bold tracking-[0.2em] text-primary" aria-hidden>OSAKA / A FRESH START</p>
          <DialogTitle className="mt-1 text-xl font-bold tracking-tight text-[hsl(224_50%_16%)]">새로운 여행을 시작할까요?</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
            여행 날짜, 선택한 장소, 방문 조건과 일정 초안이 초기화돼요. 취소하면 지금 내용을 그대로 유지해요.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button ref={cancelRef} type="button" onClick={() => onOpenChange(false)} data-testid="button-reset-cancel"
            className="min-h-[44px] rounded-lg border border-[hsl(218_30%_86%)] bg-white px-4 text-sm font-bold text-[hsl(224_50%_16%)] hover:bg-[hsl(218_40%_97%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors">
            취소
          </button>
          <button type="button" onClick={onConfirm} data-testid="button-reset-confirm"
            className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-bold text-white hover:bg-[hsl(228_80%_48%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors">
            처음부터 시작
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
