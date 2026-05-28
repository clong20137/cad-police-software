import React from 'react';
import { FileText, Image, Paperclip } from 'lucide-react';
import { MessageAttachment } from '../../types/auth';

export const MessageAttachmentPreview: React.FC<{
  attachment: MessageAttachment;
  mine: boolean;
}> = ({ attachment, mine }) => {
  const isImage = attachment.mimeType.startsWith('image/');
  const isPdf = attachment.mimeType === 'application/pdf';

  return (
    <a
      href={attachment.dataUrl}
      download={attachment.fileName}
      className={`mt-2 block overflow-hidden rounded-md text-xs font-semibold ${
        mine ? 'bg-white/15 text-white' : 'bg-white text-cad-blue dark:bg-slate-950'
      }`}
    >
      {isImage && (
        <img
          src={attachment.dataUrl}
          alt={attachment.fileName}
          className="max-h-40 w-full object-cover"
        />
      )}
      <span className="flex items-center gap-2 px-2 py-1">
        {isImage ? <Image size={13} /> : isPdf ? <FileText size={13} /> : <Paperclip size={13} />}
        <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
        <span className="shrink-0 opacity-80">{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
      </span>
    </a>
  );
};
