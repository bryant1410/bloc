This docker image accepts an optional environment variable, `ssl`, which may be
either `true` or `false` and controls whether to connect to the api via `https`
or `http`.  The default is `false`.

It also accepts `stratoHost`, which is the hostname or ip address of the machine
to which bloc should connect to access the strato API.  It defaults to the
public IP address of the machine on which the container runs.  If you are using
ssl, it is appropriate to set this variable to the symbolic hostname with the
domain for your certificates.  If you are running locally, it is appropriate to
set this to `0.0.0.0`.
