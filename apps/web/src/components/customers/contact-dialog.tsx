import { sk } from '@intra/shared/i18n';
import { contactSchema, type ContactInput } from '@intra/shared/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Resolver, useForm } from 'react-hook-form';
import { emptyPerson, PersonFields, type PersonValues } from '@/components/customers/person-fields';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { applyServerFieldErrors, refusedField } from '@/lib/form-errors';
import { type RouterOutputs, trpc } from '@/lib/trpc';

const d = sk.contacts.dialog;

/** A person as the dialog edits them: from an organization's detail or its persons table. */
export type Contact = Pick<
  RouterOutputs['customer']['get']['contacts'][number],
  | 'id'
  | 'titleBefore'
  | 'firstName'
  | 'lastName'
  | 'titleAfter'
  | 'gender'
  | 'salutation'
  | 'email'
  | 'phone'
  | 'position'
  | 'note'
  | 'unsubscribedAt'
  | 'userId'
>;

interface ContactFormValues {
  contact: PersonValues & { position: string; note: string };
  receivesBulk: boolean;
}

const toInput = (values: ContactFormValues) => ({
  contact: { ...values.contact, gender: values.contact.gender || undefined },
  receivesBulk: values.receivesBulk,
});
const schemaResolver = zodResolver(contactSchema);
/** Checks the contact as the API will get it; the error paths are the form's own. */
const resolver: Resolver<
  ContactFormValues,
  unknown,
  { contact: ContactInput; receivesBulk: boolean }
> = async (values, context, options) => {
  const input = toInput(values);
  const result = await schemaResolver(input.contact, context, options as never);
  if (Object.keys(result.errors).length > 0) {
    return { values: {}, errors: { contact: result.errors } } as never;
  }
  return {
    values: { contact: result.values as ContactInput, receivesBulk: input.receivesBulk },
    errors: {},
  };
};

function valuesOf(contact: Contact | undefined): ContactFormValues {
  if (!contact)
    return { contact: { ...emptyPerson(), position: '', note: '' }, receivesBulk: true };
  return {
    contact: {
      titleBefore: contact.titleBefore ?? '',
      firstName: contact.firstName,
      lastName: contact.lastName,
      titleAfter: contact.titleAfter ?? '',
      gender: contact.gender ?? '',
      salutation: contact.salutation ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      position: contact.position ?? '',
      note: contact.note ?? '',
    },
    receivesBulk: contact.unsubscribedAt === null,
  };
}

/** Nový kontakt or Upraviť kontakt of an organization; „Odstrániť kontakt“ asks first, elsewhere. */
export function ContactDialog({
  customerId,
  customerName,
  contact,
  onClose,
  onDelete,
}: {
  customerId: string;
  customerName: string;
  contact?: Contact | undefined;
  onClose: () => void;
  onDelete?: (() => void) | undefined;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<
    ContactFormValues,
    unknown,
    { contact: ContactInput; receivesBulk: boolean }
  >({
    resolver,
    defaultValues: valuesOf(contact),
  });
  const onError = (error: unknown) => {
    const field = refusedField(error, {
      CONTACT_EMAIL_TAKEN: ['contact.email', 'contact_email_taken'] as const,
    });
    if (field) form.setError(field[0], { type: 'server', message: field[1] });
    else {
      applyServerFieldErrors(error, form.setError);
      toast('error', errorMessage(error, sk.customers.errors));
    }
  };
  const done = async (message: string) => {
    toast('success', message);
    await queryClient.invalidateQueries(trpc.customer.pathFilter());
    onClose();
  };
  const create = useMutation(
    trpc.customer.contactCreate.mutationOptions({ onSuccess: () => done(d.created), onError }),
  );
  const update = useMutation(
    trpc.customer.contactUpdate.mutationOptions({ onSuccess: () => done(d.saved), onError }),
  );
  const pending = create.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{contact ? d.editTitle : d.newTitle}</DialogTitle>
          <DialogDescription>{customerName}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            noValidate
            className="@container space-y-4"
            onSubmit={(event) =>
              void form.handleSubmit((values) =>
                contact
                  ? update.mutate({ id: contact.id, customerId, ...values })
                  : create.mutate({ customerId, contact: values.contact }),
              )(event)
            }
          >
            <PersonFields prefix="contact" showPreview followsUser={Boolean(contact?.userId)} />
            {contact ? (
              <FormField
                control={form.control}
                name="receivesBulk"
                render={({ field }) => (
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-border-subtle p-4">
                    <div>
                      <p className="text-sm font-medium">{d.receivesBulk}</p>
                      <p className="text-xs text-muted">{d.receivesBulkHint}</p>
                    </div>
                    <Switch
                      checked={field.value}
                      label={d.receivesBulk}
                      onChange={() => field.onChange(!field.value)}
                    />
                  </div>
                )}
              />
            ) : null}
            <FormField
              control={form.control}
              name="contact.note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{d.note}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} maxLength={2000} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="sm:justify-between">
              {contact && onDelete ? (
                <Button type="button" variant="ghost" className="text-danger" onClick={onDelete}>
                  {d.delete}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  {sk.common.cancel}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? sk.common.saving : sk.common.save}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
