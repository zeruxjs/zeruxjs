import { HttpError } from 'zeruxjs';

/** Deliberately exercise the framework’s typed HTTP failure path.
 * @returns {never} Always throws the fixed safe sample HttpError; no user payload is logged here.
 */
export default () => {
  throw new HttpError(418, 'Intentional sample error from /boom', {
    sample: true,
  });
};
