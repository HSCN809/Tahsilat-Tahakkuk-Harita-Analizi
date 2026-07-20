export const formatCurrency = (rawVal: number | undefined | null): string => {
  if (rawVal === undefined || rawVal === null || isNaN(rawVal)) return '- ₺';
  
  // Multiply by 1000 because raw excel data is in "Bin TL"
  const val = rawVal * 1000;
  const absVal = Math.abs(val);
  
  if (absVal >= 1_000_000_000_000) {
    return `${(val / 1_000_000_000_000).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Trilyon ₺`;
  }
  if (absVal >= 1_000_000_000) {
    return `${(val / 1_000_000_000).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Milyar ₺`;
  }
  if (absVal >= 1_000_000) {
    return `${(val / 1_000_000).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Milyon ₺`;
  }
  if (absVal >= 1_000) {
    return `${(val / 1_000).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bin ₺`;
  }
  return `${val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
};

export const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  }
  if (bytes >= 1_024) {
    return `${(bytes / 1_024).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  }
  return `${bytes} B`;
};
