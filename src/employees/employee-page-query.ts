import { BadRequestException } from '@nestjs/common';
export function employeePageQuery(query: Record<string, string>) {
  const page = Number(query.page ?? 1),
    pageSize = Number(query.pageSize ?? 10);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    ![10, 25, 50].includes(pageSize)
  )
    throw new BadRequestException(
      'Choose a valid employee page and page size.',
    );
  const status = query.status ?? 'Active';
  if (!['All', 'Active', 'Terminated'].includes(status))
    throw new BadRequestException('Choose a valid employee status.');
  if (query.search !== undefined && typeof query.search !== 'string')
    throw new BadRequestException('Invalid employee search.');
  const search = (query.search ?? '').trim().replace(/\s+/g, ' ');
  const criteria: Record<string, unknown>[] = [];
  if (status !== 'All')
    criteria.push(
      status === 'Active'
        ? { $or: [{ status: 'Active' }, { status: null }] }
        : { status },
    );
  if (search) {
    const literal = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    criteria.push({
      $or: [
        ...['employeeId', 'firstName', 'lastName'].map((field) => ({
          [field]: { $regex: literal, $options: 'i' },
        })),
        {
          $expr: {
            $regexMatch: {
              input: {
                $concat: [
                  { $ifNull: ['$firstName', ''] },
                  ' ',
                  { $ifNull: ['$lastName', ''] },
                ],
              },
              regex: literal,
              options: 'i',
            },
          },
        },
      ],
    });
  }
  return { page, pageSize, filter: criteria.length ? { $and: criteria } : {} };
}
