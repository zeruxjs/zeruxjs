export interface Disposable { destroy():void }
export interface FocusTrap {activate():void; deactivate():void; destroy():void; readonly active:boolean; readonly topmost:boolean}
