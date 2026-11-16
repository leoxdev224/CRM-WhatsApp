export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'played';

export function normalizeMessageStatus(status: number | null | undefined): MessageStatus | null {
  switch (status) {
    case 1: return 'pending';
    case 2: return 'sent';
    case 3: return 'delivered';
    case 4: return 'read';
    case 5: return 'played';
    default: return null;
  }
}
