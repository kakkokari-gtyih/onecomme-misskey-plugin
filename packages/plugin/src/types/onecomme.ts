import type { BaseResponse } from '@onecomme.com/onesdk/types/BaseResponse';
import type { Service } from '@onecomme.com/onesdk/types/Service';

type RequiredCommentKeys = 'id' | 'userId' | 'name' | 'comment';

/**
 * `POST /api/comments` のリクエストボディ
 *
 * @see https://documenter.getpostman.com/view/20406518/2s9Y5SX6EE
 */
export type SendCommentRequest = {
    /** 送信先の枠。`id` は わんコメ側に登録されている枠のID */
    service: Pick<Service, 'id'> & Partial<Omit<Service, 'id'>>;
    comment: Pick<BaseResponse, RequiredCommentKeys> & Partial<Omit<BaseResponse, RequiredCommentKeys>>;
};
