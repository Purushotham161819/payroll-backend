export type EmployeeAccountEvent = {
  action: string;
  actorId: string;
  at: Date;
};

// Bounded, account-owned audit trail, written atomically with lifecycle updates.
// Account/organization ownership comes from the containing AuthUser document.
export function employeeAccountAudit(
  role: string,
  actions: string[],
  actorId: string,
  at = new Date(),
) {
  return role === 'employee'
    ? {
        $push: {
          portalAudit: {
            $each: actions.map((action) => ({ action, actorId, at })),
            $slice: -100,
          },
        },
      }
    : {};
}
