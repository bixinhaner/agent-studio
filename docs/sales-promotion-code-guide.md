# Bailey 优惠码使用说明（销售版）

## 1. 优惠码是什么

优惠码用于在客户续费或购买 Bailey 商业订阅时，提供折扣、赠送订阅时长，或进行特殊免费开通。

客户支付成功后，系统会为客户所在组织开通或延长订阅。也就是说，订阅权益是开通给整个客户组织，不是只开通给付款人个人账号。

## 2. 客户怎么使用优惠码

客户操作流程：

1. 打开 Bailey Portal 的续费链接。
2. 在续费页面选择套餐：Plus 或 Pro。
3. 在 Promotion code 输入框填写销售提供的优惠码。
4. 点击 Apply。
5. 页面会显示优惠效果，例如减免金额、赠送天数或免费访问。
6. 点击 Continue to secure payment。
7. 进入 Stripe 完成付款或支付方式绑定。
8. 支付完成后，Bailey 自动为客户组织开通或延长订阅。

注意：客户必须在点击付款前输入优惠码并点击 Apply。付款完成后，优惠码不能再补录到这笔订单。

## 3. 优惠码类型

| 类型 | 适合场景 | 客户看到的效果 |
| --- | --- | --- |
| Gift days | 赠送使用时长，但客户仍正常付款 | 支付原价，同时订阅多送若干天 |
| Percent off | 给客户按比例打折 | 本次付款金额按百分比减少 |
| Amount off | 给客户固定金额优惠 | 本次付款金额直接减免指定金额 |
| Free access | 特批免费开通或免费延期 | 本次付款金额变为 0，可直接开通或进入支付方式绑定流程 |

## 4. 销售推荐用法

### 4.1 首选：Gift days

销售最推荐使用 Gift days。

原因：

- 不改变官方套餐价格。
- 不削弱 Plus / Pro 的价格认知。
- 客户仍然按正式年费付款。
- 可以灵活赠送 30 天、60 天、90 天。
- 财务统计和续费判断更清晰。

推荐规则：

| 销售场景 | 推荐优惠 |
| --- | --- |
| 普通续费推进 | Gift days 30 |
| 客户需要内部审批时间 | Gift days 60 |
| 大客户 PoC 继续验证 | Gift days 60-90 |
| 渠道或战略客户 | Gift days 90，需内部确认 |

### 4.2 折扣类优惠

Percent off 和 Amount off 适合已经明确需要降价的商业谈判。

示例：

- 10% off：首年小幅折扣。
- 200 USD off：固定金额减免。
- 500 USD off：特殊审批客户。

注意：折扣会直接减少公司实际收入。销售使用前建议内部确认。

### 4.3 Free access

Free access 适合特殊情况。

常见场景：

- 内部批准的免费延长期。
- 大客户 PoC 继续延期。
- 已经线下付款，但需要线上开通。
- 补偿客户体验问题。
- 需要临时保障客户不中断访问。

如果客户启用了自动续费，Free access 也可能进入 Stripe 支付方式绑定流程，用于保存后续续费的支付方式。

## 5. 优惠码限制能力

创建优惠码时，可以配置适用范围，避免被转发滥用。

可限制条件：

| 限制项 | 说明 |
| --- | --- |
| 套餐 | 只适用于 Plus 或只适用于 Pro |
| 客户组织 | 只允许指定客户组织使用 |
| 邮箱域名 | 只允许指定邮箱域名使用，例如 customer.com |
| 开始时间 | 到达指定时间后才可使用 |
| 过期时间 | 超过指定时间后不可使用 |
| 总使用次数 | 限制整个优惠码最多被使用多少次 |
| 每客户使用次数 | 限制每个客户组织最多使用多少次 |

销售给单一客户发送优惠码时，建议绑定客户组织或邮箱域名。

公开市场活动码可以使用总次数加过期时间控制风险。

## 6. 客户可能会问的问题

### 6.1 使用优惠码后还需要绑卡吗？

取决于优惠码效果和是否开启自动续费。

- 如果优惠码只是赠送天数或部分折扣，客户仍需要付款，因此需要进入 Stripe 完成支付。
- 如果优惠码让本次付款金额变为 0，且不需要自动续费，系统可以直接开通。
- 如果本次付款金额为 0，但客户选择保持自动续费，Stripe 可能要求绑定支付方式，用于后续自动续费。

### 6.2 优惠码是否改变套餐价格？

不改变官方套餐价格。

优惠码只影响本次订单，例如本次减免、本次免费、或本次赠送额外天数。

### 6.3 优惠码是否影响套餐次数？

不影响套餐本身的月度使用容量。

Plus 和 Pro 的月度 AI requests 容量仍按当前正式套餐配置执行。优惠码只影响价格或订阅时长。

### 6.4 客户付款后是给谁开通？

开通给客户组织。

客户组织下的其他有效用户也会获得对应组织订阅权益。

### 6.5 优惠码为什么不可用？

常见原因：

- 优惠码输入错误。
- 优惠码已过期。
- 优惠码还未到开始时间。
- 优惠码已达到使用次数上限。
- 客户不在允许的组织范围内。
- 客户邮箱域名不符合限制。
- 选择的套餐不适用该优惠码。

## 7. 销售推荐话术

### 7.1 赠送时长

> We can provide a promotion code that adds extra access days to your annual subscription. You will keep the same official plan price, and the additional access time will be applied automatically after checkout.

### 7.2 首年折扣

> We can provide a one-time promotion code for your first annual subscription. Please enter the code in the Promotion code field before continuing to secure payment.

### 7.3 免费延期

> We can provide a temporary access extension code. After applying it, Bailey will update your organization's access automatically.

### 7.4 引导客户付款

> Please open the renewal link, choose the plan, enter the promotion code, and click Apply before continuing to secure payment.

## 8. 内部使用建议

| 场景 | 推荐方案 |
| --- | --- |
| 普通续费推进 | Gift days 30 |
| 客户还在走采购审批 | Gift days 60 |
| 大客户 PoC 延长 | Gift days 60-90 |
| 已承诺首年折扣 | Percent off 或 Amount off |
| 特批免费延期 | Free access |
| 公开市场活动 | 设置总次数和过期时间 |
| 单一客户专属优惠 | 绑定客户组织或邮箱域名 |

## 9. 销售注意事项

- 不要把无限制优惠码发给多个客户，除非这是有意设计的公开活动码。
- 给单一客户使用的优惠码，建议绑定客户组织或邮箱域名。
- 折扣类优惠会降低实际收入，使用前建议内部确认。
- Gift days 是最推荐的让利方式，既能推动成交，也不改变官方价格认知。
- 优惠码应在客户付款前使用，付款完成后不要承诺可以补录。
- 如果客户付款失败，应引导客户重新打开续费链接并重新输入优惠码。
- 如果客户已经线下付款，建议使用 Free access 或后台人工开通，而不是让客户再次付款。

## 10. 一句话总结

销售优先使用 Gift days 推动成交；只有在明确商业审批后才使用折扣；特殊免费延期使用 Free access。客户只需要在 Bailey 续费页面输入优惠码并点击 Apply，系统会自动完成优惠计算和订阅开通。
