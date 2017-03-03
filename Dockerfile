FROM node:6.10.0-alpine
MAINTAINER Ilya Ostrovskiy <ilya@blockapps.net>
# Be assholes and bump alpine versions the hard way.
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.5/main/' > /etc/apk/repositories
RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.5/community/' >> /etc/apk/repositories
RUN apk upgrade --no-cache
RUN mkdir -p /usr/lib/strato/bloc-server
RUN mkdir -p /var/run/strato
ENV APKS="git python alpine-sdk nasm autoconf automake zlib zlib-dev"
COPY . /usr/lib/strato/bloc-server/
COPY pkg/doit.sh /
RUN apk add --no-cache $APKS                                  && \
    cd /usr/lib/strato/bloc-server/                                        && \
    rm -rf /usr/lib/strato/bloc-server/{pkg, Dockerfile, Basilbuild}                                        && \
    npm set progress=false                                    && \
    npm update --quiet                                        && \
    cd /var/run/strato                                        && \
    node /usr/lib/strato/bloc-server/bin/main.js init --optIn --appName bloc-server --developer explorer --apiURL 'http://%APIURL%'                             && \
    cd /var/run/strato/bloc-server                                        && \
    npm install --quiet                                       && \
    node_modules/bower/bin/bower --allow-root --force install && \
    apk del $APKS
RUN apk add --no-cache curl
