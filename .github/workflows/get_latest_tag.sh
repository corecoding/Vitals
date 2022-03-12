#!/bin/bash

tag_context=${TAG_CONTEXT:-repo}
case "$tag_context" in
    *repo*)
        echo "here 1"
        taglist="$(git for-each-ref --sort=-v:refname --format '%(refname:lstrip=2)' | grep -E "$tagFmt")"
        tag="$(semver $taglist | tail -n 1)"
        semver $taglist | tail -n 1
        echo $tag

        pre_taglist="$(git for-each-ref --sort=-v:refname --format '%(refname:lstrip=2)' | grep -E "$preTagFmt")"
        pre_tag="$(semver "$pre_taglist" | tail -n 1)"
        ;;
    *branch*)
        echo "here 2"
        taglist="$(git tag --list --merged HEAD --sort=-v:refname | grep -E "$tagFmt")"
        tag="$(semver $taglist | tail -n 1)"

        pre_taglist="$(git tag --list --merged HEAD --sort=-v:refname | grep -E "$preTagFmt")"
        pre_tag=$(semver "$pre_taglist" | tail -n 1)
        ;;
    * ) echo "Unrecognized context"; exit 1;;
esac

echo *$tag*
echo *$pre_tag*
