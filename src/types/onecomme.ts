import type { ExternalComment } from '@onecomme.com/onesdk/types/Comment';
import type { Service } from '@onecomme.com/onesdk/types/Service';

export type SendCommentRequest = {
    service: Omit<Partial<Service>, 'id'> & { id: string };
    comment: ExternalComment;
};
