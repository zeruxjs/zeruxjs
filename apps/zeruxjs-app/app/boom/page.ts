import { HttpError } from "zeruxjs";

export default () => {
  throw new HttpError(418, "Intentional sample error from /boom", {
    sample: true
  });
};
